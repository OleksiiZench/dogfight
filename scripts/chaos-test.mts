import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import WebSocket from "ws";
import { loadConfig } from "../server/src/config.ts";
import { createApp } from "../server/src/index.ts";

interface ChaosClient {
	ws: WebSocket;
	messages: Array<{ type: string; reason?: string }>;
	closed: Promise<number | undefined>;
	timer?: NodeJS.Timeout;
}

interface ChaosReport {
	clientKill: {
		beforeControlP99Ms: number;
		afterControlP99Ms: number;
		playersAfter: number;
	};
	garbageFlood: {
		attemptedFrames: number;
		durationMs: number;
		ratePerSecond: number;
		closeCode: number | undefined;
		payloadRejections: number;
		beforeControlP99Ms: number;
		afterControlP99Ms: number;
	};
	gracefulShutdown: {
		shutdownReason: string;
		closeCode: number | undefined;
		reconnectDelayMs: number;
		helloAfterReconnect: boolean;
	};
	metrics: Record<string, unknown>;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
	Boolean(value) && typeof value === "object" && !Array.isArray(value);

const sleep = (ms: number): Promise<void> =>
	new Promise<void>((resolveSleep) => setTimeout(resolveSleep, ms));

function option(name: string, fallback: string): string {
	const prefix = `--${name}=`;
	const found = process.argv.find((arg) => arg.startsWith(prefix));
	return found ? found.slice(prefix.length) : fallback;
}

function expectRecord(value: unknown, label: string): Record<string, unknown> {
	if (!isRecord(value)) throw new Error(`${label} has to be an object`);
	return value;
}

function expectNumber(value: unknown, label: string): number {
	if (typeof value !== "number") throw new Error(`${label} has to be a number`);
	return value;
}

async function fetchJson(url: string): Promise<unknown> {
	const response = await fetch(url);
	if (!response.ok) throw new Error(`${url} returned ${response.status}`);
	return response.json();
}

function decodeMessage(
	data: unknown,
): { type: string; reason?: string } | null {
	try {
		const value: unknown = JSON.parse(String(data));
		if (!isRecord(value) || typeof value.type !== "string") return null;
		return {
			type: value.type,
			reason: typeof value.reason === "string" ? value.reason : undefined,
		};
	} catch {
		return null;
	}
}

async function connect(
	port: number,
	room: string,
	name: string,
): Promise<ChaosClient> {
	const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`);
	const messages: ChaosClient["messages"] = [];
	const closed = new Promise<number | undefined>((resolveClosed) => {
		ws.once("close", (code: number) => resolveClosed(code));
	});
	ws.on("message", (data: unknown) => {
		const message = decodeMessage(data);
		if (message) messages.push(message);
	});
	await new Promise<void>((resolveOpen, rejectOpen) => {
		const timer = setTimeout(
			() => rejectOpen(new Error(`${name} did not open`)),
			5000,
		);
		ws.once("open", () => {
			clearTimeout(timer);
			resolveOpen();
		});
		ws.once("error", rejectOpen);
	});
	const joined = new Promise<void>((resolveJoin, rejectJoin) => {
		const timer = setTimeout(
			() => rejectJoin(new Error(`${name} did not join`)),
			5000,
		);
		const handler = (data: unknown): void => {
			const message = decodeMessage(data);
			if (message?.type === "welcome") {
				clearTimeout(timer);
				ws.off("message", handler);
				resolveJoin();
			}
		};
		ws.on("message", handler);
	});
	ws.send(JSON.stringify({ v: 1, type: "join", room, name, codec: "json" }));
	await joined;
	return { ws, messages, closed };
}

async function floodOnce(port: number): Promise<{
	sent: boolean;
	code: number | undefined;
}> {
	const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`);
	const closed = new Promise<number | undefined>((resolveClosed) => {
		ws.once("close", (code: number) => resolveClosed(code));
	});
	await new Promise<void>((resolveOpen, rejectOpen) => {
		const timer = setTimeout(
			() => rejectOpen(new Error("flood socket did not open")),
			5000,
		);
		ws.once("open", () => {
			clearTimeout(timer);
			resolveOpen();
		});
		ws.once("error", rejectOpen);
	});
	ws.send(
		JSON.stringify({
			v: 1,
			type: "join",
			room: "chaos-a",
			name: "Flood",
			codec: "json",
		}),
	);
	try {
		ws.send("{not json");
	} catch {
		return { sent: false, code: await closed };
	}
	return { sent: true, code: await closed };
}

async function floodGarbage(
	port: number,
	durationMs: number,
	ratePerSecond: number,
): Promise<{
	attemptedFrames: number;
	durationMs: number;
	closeCode: number | undefined;
}> {
	const batchIntervalMs = 100;
	const batchSize = Math.max(
		1,
		Math.round((ratePerSecond * batchIntervalMs) / 1000),
	);
	const deadline = Date.now() + durationMs;
	let attemptedFrames = 0;
	let closeCode: number | undefined;
	for (
		let batchStart = Date.now();
		batchStart < deadline;
		batchStart += batchIntervalMs
	) {
		const results = await Promise.all(
			Array.from({ length: batchSize }, () => floodOnce(port)),
		);
		attemptedFrames += results.filter((result) => result.sent).length;
		closeCode ??= results.find((result) => result.code !== undefined)?.code;
		await sleep(Math.max(0, batchStart + batchIntervalMs - Date.now()));
	}
	return { attemptedFrames, durationMs, closeCode };
}

function startInputs(client: ChaosClient, seqStart = 0): void {
	let seq = seqStart;
	client.timer = setInterval(() => {
		seq += 1;
		try {
			client.ws.send(
				JSON.stringify({
					v: 1,
					type: "input",
					seq,
					tick: seq,
					turn: Math.sin(seq / 12) * 0.4,
					thrust: true,
					fire: seq % 20 === 0,
				}),
			);
		} catch {}
	}, 1000 / 30);
}

async function waitForMessage(
	client: ChaosClient,
	type: string,
	timeoutMs = 5000,
): Promise<{ type: string; reason?: string }> {
	const existing = client.messages.find((message) => message.type === type);
	if (existing) return existing;
	const deadline = Date.now() + timeoutMs;
	while (Date.now() < deadline) {
		const message = client.messages.find((entry) => entry.type === type);
		if (message) return message;
		await sleep(20);
	}
	throw new Error(`timed out waiting for ${type}`);
}

async function roomPlayers(base: string, room: string): Promise<number> {
	const rooms: unknown = await fetchJson(`${base}/api/rooms`);
	if (!Array.isArray(rooms)) throw new Error("expected a list of rooms");
	for (const entry of rooms) {
		const value = expectRecord(entry, "room");
		if (value.id === room) return expectNumber(value.players, "room.players");
	}
	throw new Error(`room ${room} not found`);
}

async function waitForPlayers(
	base: string,
	room: string,
	expected: number,
): Promise<void> {
	const deadline = Date.now() + 5000;
	while (Date.now() < deadline) {
		if ((await roomPlayers(base, room)) === expected) return;
		await sleep(50);
	}
	throw new Error(`room ${room} did not reach ${expected} players`);
}

function controlP99(app: Awaited<ReturnType<typeof createApp>>): number {
	return app.matches.get("chaos-b")?.getStats().p99DurationMs ?? 0;
}

function resetControlStats(app: Awaited<ReturnType<typeof createApp>>): void {
	app.matches.get("chaos-b")?.resetStats();
}

async function freshControlP99(
	app: Awaited<ReturnType<typeof createApp>>,
	windowMs = 4500,
): Promise<number> {
	resetControlStats(app);
	await sleep(windowMs);
	return controlP99(app);
}

function assertIsolated(before: number, after: number): void {
	assert.ok(
		after <= Math.max(10, before * 3 + 2),
		`control tick p99 grew from ${before} to ${after} ms`,
	);
}

function svg(report: ChaosReport): string {
	const pairs = [
		["client kill before", report.clientKill.beforeControlP99Ms],
		["client kill after", report.clientKill.afterControlP99Ms],
		["flood before", report.garbageFlood.beforeControlP99Ms],
		["flood after", report.garbageFlood.afterControlP99Ms],
	] as const;
	const max = Math.max(4, ...pairs.map(([, value]) => value));
	const bars = pairs
		.map(([label, value], index) => {
			const height = (value / max) * 220;
			const x = 90 + index * 190;
			return `<rect x="${x}" y="${300 - height}" width="110" height="${height}" fill="#38bdf8"/><text x="${x + 55}" y="325" text-anchor="middle" font-size="13">${label}</text><text x="${x + 55}" y="${292 - height}" text-anchor="middle" font-size="13">${value.toFixed(2)} ms</text>`;
		})
		.join("");
	return `<svg xmlns="http://www.w3.org/2000/svg" width="880" height="360" viewBox="0 0 880 360"><rect width="880" height="360" fill="#0f172a"/><text x="30" y="40" fill="#e2e8f0" font-size="20">Lab 08 chaos isolation — control room tick p99</text>${bars}</svg>`;
}

function markdown(report: ChaosReport): string {
	return `# Lab 08 chaos test\n\n| Scenario | Result |\n| --- | --- |\n| Client kill | room went to ${report.clientKill.playersAfter} player; control p99 ${report.clientKill.beforeControlP99Ms.toFixed(2)} → ${report.clientKill.afterControlP99Ms.toFixed(2)} ms |\n| Garbage flood | ${report.garbageFlood.attemptedFrames} frames over ${report.garbageFlood.durationMs} ms (${report.garbageFlood.ratePerSecond}/s target), close ${report.garbageFlood.closeCode}, ${report.garbageFlood.payloadRejections} payload rejections; control p99 ${report.garbageFlood.beforeControlP99Ms.toFixed(2)} → ${report.garbageFlood.afterControlP99Ms.toFixed(2)} ms |\n| Graceful shutdown | shutdown reason “${report.gracefulShutdown.shutdownReason}”, close ${report.gracefulShutdown.closeCode}, reconnect after ${report.gracefulShutdown.reconnectDelayMs} ms, hello ${report.gracefulShutdown.helloAfterReconnect} |\n\nControl-room p99 is measured over a fresh 120-tick window per scenario. The shutdown scenario is an in-process graceful close, not an OS-level kill.\n\nMetrics snapshot: ${JSON.stringify(report.metrics)}\n`;
}

const outDir = resolve(option("out", "docs/assets"));
const temp = await mkdtemp(join(tmpdir(), "dogfight-chaos-"));
const logDir = join(temp, "logs");
const roomsFile = join(temp, "rooms.json");
await writeFile(
	roomsFile,
	JSON.stringify([
		{
			id: "chaos-a",
			name: "Chaos A",
			seed: 11,
			arena: { width: 1600, height: 900 },
			asteroidTarget: 4,
			capacity: 8,
		},
		{
			id: "chaos-b",
			name: "Chaos B",
			seed: 12,
			arena: { width: 1600, height: 900 },
			asteroidTarget: 4,
			capacity: 8,
		},
	]),
);

const baseConfig = {
	...loadConfig({ ALLOWED_ORIGINS: "*" }),
	port: 0,
	host: "127.0.0.1",
	logDir,
	roomsFile,
	maxRooms: 2,
	maxPlayersPerRoom: 8,
	maxConnectionsPerIp: 1000,
	pingIntervalMs: 60000,
};

let app = await createApp(baseConfig);
await app.listen();
const address = app.server.address();
if (!address || typeof address === "string")
	throw new Error("server has no TCP port");
const port = address.port;
const base = `http://127.0.0.1:${port}`;

const alpha = await connect(port, "chaos-a", "Alpha");
const bravo = await connect(port, "chaos-a", "Bravo");
const control = await connect(port, "chaos-b", "Control");
startInputs(alpha, 0);
startInputs(bravo, 100);
startInputs(control, 200);
await sleep(1000);

const beforeClientKill = await freshControlP99(app);
bravo.ws.terminate();
await waitForPlayers(base, "chaos-a", 1);
await sleep(4500);
const afterClientKill = controlP99(app);
assertIsolated(beforeClientKill, afterClientKill);

const beforeFlood = await freshControlP99(app);
resetControlStats(app);
const floodRatePerSecond = Number(option("flood-rate", "100"));
const floodDurationMs = Number(option("flood-duration", "5000"));
if (
	!Number.isFinite(floodRatePerSecond) ||
	floodRatePerSecond <= 0 ||
	!Number.isFinite(floodDurationMs) ||
	floodDurationMs <= 0
)
	throw new Error("invalid flood options");
const flood = await floodGarbage(port, floodDurationMs, floodRatePerSecond);
const afterFlood = controlP99(app);
assert.ok(flood.attemptedFrames > 0, "no garbage frames were sent");
assertIsolated(beforeFlood, afterFlood);
await fetch(`${base}/metrics`).then((response) => response.text());
const metrics = expectRecord(app.metrics.snapshot(), "metrics");
const rejections = expectRecord(metrics.rejections, "rejections");
const payloadRejections = expectNumber(
	rejections.payload,
	"payload rejections",
);
assert.ok(payloadRejections > 0, "garbage frames were not counted");

const shutdownMessage = waitForMessage(alpha, "shutdown");
const alphaClosed = alpha.closed;
await app.close();
const shutdown = await shutdownMessage;
const shutdownCode = await alphaClosed;
assert.equal(shutdownCode, 1001);
if (alpha.timer) clearInterval(alpha.timer);
if (bravo.timer) clearInterval(bravo.timer);
if (control.timer) clearInterval(control.timer);

const reconnectDelayMs = 500;
await sleep(reconnectDelayMs);
app = await createApp({ ...baseConfig, port });
await app.listen();
const reconnected = await connect(port, "chaos-b", "Control");
const hello = await waitForMessage(reconnected, "hello");

const report: ChaosReport = {
	clientKill: {
		beforeControlP99Ms: beforeClientKill,
		afterControlP99Ms: afterClientKill,
		playersAfter: 1,
	},
	garbageFlood: {
		attemptedFrames: flood.attemptedFrames,
		durationMs: flood.durationMs,
		ratePerSecond: floodRatePerSecond,
		closeCode: flood.closeCode,
		payloadRejections,
		beforeControlP99Ms: beforeFlood,
		afterControlP99Ms: afterFlood,
	},
	gracefulShutdown: {
		shutdownReason: shutdown.reason ?? "server shutdown",
		closeCode: shutdownCode,
		reconnectDelayMs,
		helloAfterReconnect: hello.type === "hello",
	},
	metrics,
};

await writeFile(
	join(outDir, "lab-08-chaos.json"),
	`${JSON.stringify(report, null, 2)}\n`,
);
await writeFile(join(outDir, "lab-08-chaos.svg"), svg(report));
await writeFile(join(outDir, "lab-08-chaos.md"), markdown(report));
console.log(JSON.stringify(report, null, 2));

await app.close();
await reconnected.ws.close();
await alpha.ws.close();
await rm(temp, { recursive: true, force: true });
