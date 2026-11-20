import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { performance } from "node:perf_hooks";
import WebSocket from "ws";
import { loadConfig } from "../src/config.ts";
import { createApp } from "../src/index.ts";

interface LoadClient {
	ws: WebSocket;
	seq: number;
	phase: number;
	timer?: NodeJS.Timeout;
}

interface LoadRow {
	clients: number;
	bots: number;
	meanTickMs: number;
	p95TickMs: number;
	p99TickMs: number;
	maxTickMs: number;
	p99JitterMs: number;
	eventLoopUtilization: number;
	rssMb: number;
	bytesInPerSec: number;
	bytesOutPerSec: number;
	capacityExceeded: boolean;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
	Boolean(value) && typeof value === "object" && !Array.isArray(value);

function option(name: string, fallback: string): string {
	const prefix = `--${name}=`;
	const found = process.argv.find((arg) => arg.startsWith(prefix));
	return found ? found.slice(prefix.length) : fallback;
}

const sleep = (ms: number): Promise<void> =>
	new Promise<void>((resolveSleep) => setTimeout(resolveSleep, ms));

function joinMessage(index: number): string {
	return JSON.stringify({
		v: 1,
		type: "join",
		room: "load",
		name: `load-${index}`,
		codec: "binary",
	});
}

async function connectClient(
	port: number,
	index: number,
	step: number,
): Promise<LoadClient> {
	const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`);
	await new Promise<void>((resolveOpen, rejectOpen) => {
		const timer = setTimeout(
			() => rejectOpen(new Error(`client ${index} did not open at ${step}`)),
			5000,
		);
		ws.once("open", () => {
			clearTimeout(timer);
			resolveOpen();
		});
		ws.once("error", (error: Error) => {
			clearTimeout(timer);
			rejectOpen(error);
		});
	});

	const joined = new Promise<void>((resolveJoin, rejectJoin) => {
		const timer = setTimeout(
			() => rejectJoin(new Error(`client ${index} did not join at ${step}`)),
			10000,
		);
		const handler = (data: unknown): void => {
			let message: unknown;
			try {
				message = JSON.parse(String(data));
			} catch {
				return;
			}
			if (isRecord(message) && message.type === "welcome") {
				clearTimeout(timer);
				ws.off("message", handler);
				resolveJoin();
			}
		};
		ws.on("message", handler);
	});
	ws.send(joinMessage(index));
	await joined;

	const client: LoadClient = {
		ws,
		seq: 0,
		phase: (index * Math.PI * 2) / 17,
	};
	client.timer = setInterval(() => {
		client.seq += 1;
		const turn = Math.sin(client.seq / 30 + client.phase) * 0.6;
		try {
			ws.send(
				JSON.stringify({
					v: 1,
					type: "input",
					seq: client.seq,
					tick: client.seq,
					turn,
					thrust: true,
					fire: client.seq % (12 + (index % 8)) === 0,
				}),
			);
		} catch {
			return;
		}
	}, 1000 / 30);
	return client;
}

async function disconnect(clients: readonly LoadClient[]): Promise<void> {
	await Promise.all(
		clients.map(
			(client) =>
				new Promise<void>((resolveClose) => {
					if (client.timer) clearInterval(client.timer);
					if (client.ws.readyState === WebSocket.CLOSED) {
						resolveClose();
						return;
					}
					const timer = setTimeout(() => {
						client.ws.terminate();
						resolveClose();
					}, 2000);
					client.ws.once("close", () => {
						clearTimeout(timer);
						resolveClose();
					});
					if (client.ws.readyState === WebSocket.OPEN)
						client.ws.close(1000, "load step complete");
				}),
		),
	);
}

async function waitForRoomDrained(port: number): Promise<void> {
	const deadline = Date.now() + 10000;
	while (Date.now() < deadline) {
		const rooms = expectArray(
			await fetchJson(`http://127.0.0.1:${port}/api/rooms`),
			"rooms",
		);
		const room = rooms
			.map((entry) => expectRecord(entry, "room"))
			.find((entry) => entry.id === "load");
		if (room && expectNumber(room.players, "room.players") <= 1) return;
		await sleep(100);
	}
	throw new Error("load room did not drain between steps");
}

async function fetchJson(url: string): Promise<unknown> {
	const response = await fetch(url);
	if (!response.ok) throw new Error(`${url} returned ${response.status}`);
	return response.json();
}

function expectRecord(value: unknown, label: string): Record<string, unknown> {
	if (!isRecord(value)) throw new Error(`${label} has to be an object`);
	return value;
}

function expectArray(value: unknown, label: string): unknown[] {
	if (!Array.isArray(value)) throw new Error(`${label} has to be an array`);
	return value;
}

function expectNumber(value: unknown, label: string): number {
	if (typeof value !== "number") throw new Error(`${label} has to be a number`);
	return value;
}

function chart(rows: readonly LoadRow[]): string {
	const width = 960;
	const height = 420;
	const left = 72;
	const right = 32;
	const top = 32;
	const bottom = 72;
	const maxClients = Math.max(1, ...rows.map((row) => row.clients));
	const maxTick = Math.max(40, ...rows.map((row) => row.p99TickMs));
	const scaleX = (clients: number): number =>
		left + (clients / maxClients) * (width - left - right);
	const scaleY = (value: number): number =>
		height - bottom - (value / (maxTick * 1.15)) * (height - top - bottom);
	const points = rows
		.map(
			(row) =>
				`${scaleX(row.clients).toFixed(1)},${scaleY(row.p99TickMs).toFixed(1)}`,
		)
		.join(" ");
	const labels = rows
		.map(
			(row) =>
				`<text x="${scaleX(row.clients).toFixed(1)}" y="${height - bottom + 22}" text-anchor="middle" font-size="12" fill="#cbd5e1">${row.clients}</text>` +
				`<text x="${scaleX(row.clients).toFixed(1)}" y="${(scaleY(row.p99TickMs) - 8).toFixed(1)}" text-anchor="middle" font-size="11" fill="#f8fafc">${row.p99TickMs.toFixed(2)}</text>`,
		)
		.join("");
	const grid = [0, 8, 16, 24, 32, 40]
		.filter((value) => value <= maxTick * 1.15)
		.map(
			(value) =>
				`<line x1="${left}" x2="${width - right}" y1="${scaleY(value).toFixed(1)}" y2="${scaleY(value).toFixed(1)}" stroke="#334155"/>` +
				`<text x="${left - 8}" y="${(scaleY(value) + 4).toFixed(1)}" text-anchor="end" font-size="11" fill="#94a3b8">${value}</text>`,
		)
		.join("");
	return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}"><rect width="100%" height="100%" fill="#0f172a"/>${grid}<line x1="${left}" x2="${width - right}" y1="${scaleY(33).toFixed(1)}" y2="${scaleY(33).toFixed(1)}" stroke="#f87171" stroke-dasharray="6 4"/><text x="${width - right}" y="${(scaleY(33) - 6).toFixed(1)}" text-anchor="end" font-size="12" fill="#fca5a5">33 ms budget</text><polyline points="${points}" fill="none" stroke="#38bdf8" stroke-width="3"/>${labels}<text x="${width / 2}" y="${height - 18}" text-anchor="middle" font-size="13" fill="#cbd5e1">headless WebSocket clients</text><text x="18" y="${height / 2}" transform="rotate(-90 18 ${height / 2})" text-anchor="middle" font-size="13" fill="#cbd5e1">server tick p99 (ms)</text></svg>`;
}

async function main(): Promise<void> {
	const clientsArg = option("clients", "8,32,64,128");
	const clientCounts = clientsArg
		.split(",")
		.map((value) => Number(value.trim()))
		.filter((value) => Number.isInteger(value) && value > 0);
	if (clientCounts.length === 0) throw new Error("no client counts given");
	const botCount = Number(option("bots", "16"));
	const durationMs = Number(option("duration", "10000"));
	const warmupMs = Number(option("warmup", "3000"));
	const outDir = resolve(option("out", "docs/assets"));
	const port = Number(option("port", "3198"));
	const tempDir = await mkdtemp(join(tmpdir(), "dogfight-load-"));
	const roomsFile = join(tempDir, "rooms.json");
	await writeFile(
		roomsFile,
		JSON.stringify([
			{
				id: "load",
				name: "Load",
				seed: 11,
				arena: { width: 1600, height: 900 },
				asteroidTarget: 8,
				capacity: Math.max(...clientCounts) + botCount + 8,
			},
		]),
	);

	const config = {
		...loadConfig({}),
		host: "127.0.0.1",
		port,
		logDir: join(tempDir, "logs"),
		roomsFile,
		maxPlayersPerRoom: Math.max(...clientCounts) + botCount + 8,
		messagesPerSecond: 90,
		joinTimeoutMs: 10000,
		pingIntervalMs: 60000,
	};
	const app = await createApp(config);
	await app.listen();
	const rows: LoadRow[] = [];
	let clients: LoadClient[] = [];
	let anchor: LoadClient | null = null;
	try {
		const botsResponse = await fetch(
			`http://127.0.0.1:${port}/api/rooms/load/bots`,
			{
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({ count: botCount }),
			},
		);
		if (!botsResponse.ok)
			throw new Error(`bots endpoint returned ${botsResponse.status}`);
		anchor = await connectClient(port, 9999, 0);
		if (anchor.timer) clearInterval(anchor.timer);

		for (const count of clientCounts) {
			const started: LoadClient[] = [];
			for (let index = 0; index < count; index += 16) {
				const batch = await Promise.all(
					Array.from({ length: Math.min(16, count - index) }, (_, offset) =>
						connectClient(port, index + offset, count),
					),
				);
				started.push(...batch);
				if (index + 16 < count) await sleep(100);
			}
			clients = started;
			await sleep(warmupMs);

			let previousElu = performance.eventLoopUtilization();
			let previousIn = app.gameServer.stats.bytesIn;
			let previousOut = app.gameServer.stats.bytesOut;
			const samples: Array<{
				tickMs: number;
				p95TickMs: number;
				p99TickMs: number;
				maxTickMs: number;
				p99JitterMs: number;
				elu: number;
				rssMb: number;
				bytesIn: number;
				bytesOut: number;
			}> = [];
			const deadline = Date.now() + durationMs;
			while (Date.now() < deadline) {
				await sleep(250);
				const stats = expectRecord(
					await fetchJson(`http://127.0.0.1:${port}/api/stats`),
					"stats",
				);
				const match = expectArray(stats.matches, "matches")
					.map((entry) => expectRecord(entry, "match"))
					.find((entry) => entry.id === "load");
				if (!match) throw new Error("load match disappeared");
				const elu = performance.eventLoopUtilization(previousElu);
				previousElu = elu;
				const currentIn = app.gameServer.stats.bytesIn;
				const currentOut = app.gameServer.stats.bytesOut;
				samples.push({
					tickMs: expectNumber(match.meanDurationMs, "meanDurationMs"),
					p95TickMs: expectNumber(match.p95DurationMs, "p95DurationMs"),
					p99TickMs: expectNumber(match.p99DurationMs, "p99DurationMs"),
					maxTickMs: expectNumber(match.maxDurationMs, "maxDurationMs"),
					p99JitterMs: expectNumber(match.p99JitterMs, "p99JitterMs"),
					elu: elu.utilization,
					rssMb: process.memoryUsage().rss / 1024 / 1024,
					bytesIn: currentIn - previousIn,
					bytesOut: currentOut - previousOut,
				});
				previousIn = currentIn;
				previousOut = currentOut;
			}
			const mean = (values: readonly number[]): number =>
				values.length
					? values.reduce((sum, value) => sum + value, 0) / values.length
					: 0;
			const peak = (values: readonly number[]): number =>
				values.length ? Math.max(...values) : 0;
			const p99Tick = mean(samples.map((sample) => sample.p99TickMs));
			rows.push({
				clients: count,
				bots: botCount,
				meanTickMs: mean(samples.map((sample) => sample.tickMs)),
				p95TickMs: mean(samples.map((sample) => sample.p95TickMs)),
				p99TickMs: p99Tick,
				maxTickMs: peak(samples.map((sample) => sample.maxTickMs)),
				p99JitterMs: mean(samples.map((sample) => sample.p99JitterMs)),
				eventLoopUtilization: mean(samples.map((sample) => sample.elu)),
				rssMb: peak(samples.map((sample) => sample.rssMb)),
				bytesInPerSec: mean(samples.map((sample) => sample.bytesIn)) * 4,
				bytesOutPerSec: mean(samples.map((sample) => sample.bytesOut)) * 4,
				capacityExceeded: p99Tick > 33,
			});
			await disconnect(clients);
			await waitForRoomDrained(port);
			clients = [];
		}
	} finally {
		await disconnect(clients);
		await disconnect(anchor ? [anchor] : []);
		await app.close();
		await rm(tempDir, { recursive: true, force: true });
	}

	const capacity = rows.find((row) => row.capacityExceeded)?.clients ?? null;
	const header = [
		"clients",
		"bots",
		"meanTickMs",
		"p95TickMs",
		"p99TickMs",
		"maxTickMs",
		"p99JitterMs",
		"eventLoopUtilization",
		"rssMb",
		"bytesInPerSec",
		"bytesOutPerSec",
		"capacityExceeded",
	];
	const csv = [
		header.join(","),
		...rows.map((row) =>
			header.map((key) => String(row[key as keyof LoadRow])).join(","),
		),
	].join("\n");
	await writeFile(resolve(outDir, "lab-07-load.csv"), `${csv}\n`);
	await writeFile(resolve(outDir, "lab-07-load.svg"), chart(rows));
	await writeFile(
		resolve(outDir, "lab-07-load.json"),
		JSON.stringify({ capacity, rows }, null, 2),
	);
	console.log(JSON.stringify({ capacity, rows }, null, 2));
}

await main();
