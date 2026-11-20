import assert from "node:assert/strict";
import { once } from "node:events";
import { mkdtemp, rm } from "node:fs/promises";
import type { IncomingMessage } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ServerMessage } from "shared/protocol.ts";
import { parseServerMessage } from "shared/protocol.ts";
import { onTestFinished, test } from "vitest";
import type { RawData } from "ws";
import WebSocket from "ws";
import { loadConfig } from "../src/config.ts";
import { createApp } from "../src/index.ts";

const sleep = (ms: number): Promise<void> =>
	new Promise<void>((resolve) => setTimeout(resolve, ms));

const isRecord = (value: unknown): value is Record<string, unknown> =>
	Boolean(value) && typeof value === "object" && !Array.isArray(value);

function expectRecord(value: unknown, label: string): Record<string, unknown> {
	if (!isRecord(value)) throw new Error(`${label} has to be an object`);
	return value;
}

function expectNumber(value: unknown, label: string): number {
	if (typeof value !== "number") throw new Error(`${label} has to be a number`);
	return value;
}

function decodeMessage(data: RawData): ServerMessage | null {
	const result = parseServerMessage(data.toString());
	return result.ok ? result.value : null;
}

async function startApp(overrides: Record<string, string | undefined> = {}) {
	const logDir = await mkdtemp(join(tmpdir(), "dogfight-prod-"));
	const config = {
		...loadConfig({
			VERSION: "v1.0.0",
			ALLOWED_ORIGINS: "*",
			...overrides,
		}),
		port: 0,
		host: "127.0.0.1",
		logDir,
	};
	const app = await createApp(config);
	onTestFinished(async () => {
		await app.close();
		await rm(logDir, { recursive: true, force: true });
	});
	await app.listen();
	const address = app.server.address();
	if (!address || typeof address === "string")
		throw new Error("server has no TCP port");
	return { app, base: `http://127.0.0.1:${address.port}`, port: address.port };
}

function connect(port: number, options: { origin?: string } = {}): WebSocket {
	return new WebSocket(`ws://127.0.0.1:${port}/ws`, options);
}

async function rejectionStatus(socket: WebSocket): Promise<number | undefined> {
	return new Promise((resolve, reject) => {
		socket.once(
			"unexpected-response",
			(_request, response: IncomingMessage) => {
				response.resume();
				resolve(response.statusCode);
			},
		);
		socket.once("open", () => resolve(undefined));
		socket.once("error", reject);
	});
}

async function waitForMessage(
	socket: WebSocket,
	predicate: (message: ServerMessage) => boolean,
	timeoutMs = 1500,
): Promise<ServerMessage> {
	return new Promise((resolve, reject) => {
		const timer = setTimeout(() => {
			cleanup();
			reject(new Error("timed out waiting for message"));
		}, timeoutMs);
		const handler = (data: RawData): void => {
			const message = decodeMessage(data);
			if (message && predicate(message)) {
				cleanup();
				resolve(message);
			}
		};
		const cleanup = (): void => {
			clearTimeout(timer);
			socket.off("message", handler);
		};
		socket.on("message", handler);
	});
}

test("health, readiness, version stamp and metrics are exposed", async () => {
	const { app, base } = await startApp();
	const health = expectRecord(
		await fetch(`${base}/health`).then((r) => r.json()),
		"health",
	);
	assert.equal(health.ok, true);
	assert.equal(health.ready, true);
	assert.equal(health.version, "v1.0.0");

	const readyResponse = await fetch(`${base}/ready`);
	assert.equal(readyResponse.status, 200);
	assert.equal(expectRecord(await readyResponse.json(), "ready").ready, true);

	const metricsResponse = await fetch(`${base}/metrics`);
	assert.equal(metricsResponse.status, 200);
	assert.match(
		metricsResponse.headers.get("content-type") ?? "",
		/^text\/plain; version=0\.0\.4/,
	);
	const metricsText = await metricsResponse.text();
	assert.match(metricsText, /dogfight_build_info\{version="v1\.0\.0"\} 1/);
	assert.match(metricsText, /dogfight_rooms/);
	assert.match(metricsText, /dogfight_messages_total/);
	assert.match(metricsText, /dogfight_rejections_total\{reason="origin"\} 0/);
	assert.match(metricsText, /dogfight_event_loop_utilization/);
	assert.match(metricsText, /dogfight_process_resident_memory_bytes/);
	assert.ok(
		expectNumber(
			app.metrics.snapshot().eventLoopUtilization,
			"eventLoopUtilization",
		) >= 0,
	);
});

test("production rejects disallowed and missing origins", async () => {
	const { port } = await startApp({
		NODE_ENV: "production",
		ALLOWED_ORIGINS: "https://example.test",
	});
	const evil = connect(port, { origin: "https://evil.test" });
	assert.equal(await rejectionStatus(evil), 403);
	const missing = connect(port);
	assert.equal(await rejectionStatus(missing), 403);
});

test("per-IP connection cap is enforced", async () => {
	const { port } = await startApp({ MAX_CONNECTIONS_PER_IP: "2" });
	const first = connect(port);
	const second = connect(port);
	await Promise.all([once(first, "open"), once(second, "open")]);
	const third = connect(port);
	assert.equal(await rejectionStatus(third), 429);
	first.close();
	second.close();
});

test("shutdown sends a message, closes with 1001 and flips readiness", async () => {
	const { app, port } = await startApp();
	const socket = connect(port);
	await once(socket, "open");
	socket.send(
		JSON.stringify({ v: 1, type: "join", room: "training", name: "Pilot" }),
	);
	await waitForMessage(socket, (message) => message.type === "welcome");

	const shutdown = waitForMessage(
		socket,
		(message) => message.type === "shutdown",
	);
	const closed = once(socket, "close");
	await app.close();
	const message = await shutdown;
	assert.equal(message.type, "shutdown");
	const [code] = await closed;
	assert.equal(code, 1001);

	const state = expectRecord(app.metrics.snapshot(), "metrics");
	assert.equal(state.wsClients, 0);
});

test("readiness is false while shutting down", async () => {
	const { app, base } = await startApp();
	const closing = app.close();
	const response = await fetch(`${base}/ready`);
	assert.equal(response.status, 503);
	assert.equal(expectRecord(await response.json(), "ready").ready, false);
	await closing;
	await sleep(0);
});
