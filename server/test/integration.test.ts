import assert from "node:assert/strict";
import { once } from "node:events";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ServerMessage } from "shared/protocol.ts";
import { parseServerMessage } from "shared/protocol.ts";
import { onTestFinished, test } from "vitest";
import type { RawData } from "ws";
import WebSocket from "ws";
import { loadConfig } from "../src/config.ts";
import { createApp } from "../src/index.ts";
import { CLOSE } from "../src/protocol.ts";

const sleep = (ms: number): Promise<void> =>
	new Promise<void>((resolve) => setTimeout(resolve, ms));

const isRecord = (value: unknown): value is Record<string, unknown> =>
	Boolean(value) && typeof value === "object" && !Array.isArray(value);

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

function expectString(value: unknown, label: string): string {
	if (typeof value !== "string") throw new Error(`${label} has to be a string`);
	return value;
}

async function fetchJson(url: string): Promise<unknown> {
	const response = await fetch(url);
	const value: unknown = await response.json();
	return value;
}

function decodeMessage(data: RawData): ServerMessage | null {
	const result = parseServerMessage(data.toString());
	return result.ok ? result.value : null;
}

interface TestClient {
	ws: WebSocket;
	messages: ServerMessage[];
}

async function connect(port: number): Promise<TestClient> {
	const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`);
	const messages: ServerMessage[] = [];
	ws.on("message", (data: RawData) => {
		const message = decodeMessage(data);
		if (message) messages.push(message);
	});
	await once(ws, "open");
	return { ws, messages };
}

async function waitFor(
	client: TestClient,
	predicate: (message: ServerMessage) => boolean,
	timeoutMs = 1500,
): Promise<ServerMessage> {
	const existing = client.messages.find(predicate);
	if (existing) return existing;
	return new Promise<ServerMessage>((resolve, reject) => {
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
			client.ws.off("message", handler);
		};
		client.ws.on("message", handler);
	});
}

async function until<T>(
	check: () => Promise<T | false>,
	timeoutMs = 1500,
): Promise<T> {
	const deadline = Date.now() + timeoutMs;
	while (Date.now() < deadline) {
		const value = await check();
		if (value) return value;
		await sleep(25);
	}
	throw new Error("condition was not met in time");
}

test("http, rooms, chat and replay work together", async () => {
	const logDir = await mkdtemp(join(tmpdir(), "dogfight-int-"));
	const config = {
		...loadConfig({}),
		port: 0,
		host: "127.0.0.1",
		logDir,
		joinTimeoutMs: 500,
		pingIntervalMs: 60000,
		messagesPerSecond: 20,
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
	const port = address.port;
	const base = `http://127.0.0.1:${port}`;

	const health = expectRecord(await fetchJson(`${base}/health`), "health");
	assert.equal(health.ok, true);
	assert.equal(expectNumber(health.rooms, "health.rooms"), 3);
	const stats = expectRecord(await fetchJson(`${base}/api/stats`), "stats");
	const matches = expectArray(stats.matches, "stats.matches");
	assert.equal(matches.length, 3);
	const firstMatch = expectRecord(matches[0], "first match");
	assert.equal(expectNumber(firstMatch.tickRate, "tickRate"), 30);
	assert.equal(
		expectArray(await fetchJson(`${base}/api/rooms`), "rooms").length,
		3,
	);

	const botsPost = await fetch(`${base}/api/rooms/training/bots`, {
		method: "POST",
		headers: { "content-type": "application/json" },
		body: JSON.stringify({ count: 3 }),
	});
	assert.equal(botsPost.status, 200);
	assert.equal(expectRecord(await botsPost.json(), "bots").bots, 3);
	const botsStats = expectRecord(await fetchJson(`${base}/api/stats`), "stats");
	const trainingStats = expectArray(botsStats.matches, "matches")
		.map((entry) => expectRecord(entry, "match"))
		.find((entry) => entry.id === "training");
	assert.ok(trainingStats);
	assert.equal(trainingStats.bots, 3);
	const botsDelete = await fetch(`${base}/api/rooms/training/bots`, {
		method: "DELETE",
	});
	assert.equal(botsDelete.status, 200);
	assert.equal(expectRecord(await botsDelete.json(), "bots").bots, 0);

	const alpha = await connect(port);
	const beta = await connect(port);
	alpha.ws.send(
		JSON.stringify({ v: 1, type: "join", room: "training", name: "Alpha" }),
	);
	beta.ws.send(
		JSON.stringify({ v: 1, type: "join", room: "training", name: "Beta" }),
	);
	await waitFor(alpha, (message) => message.type === "welcome");
	await waitFor(beta, (message) => message.type === "welcome");
	const roster = await waitFor(
		alpha,
		(message) => message.type === "roster" && message.players.length === 2,
	);
	if (roster.type !== "roster") throw new Error("expected a roster message");
	assert.deepEqual(roster.players.map((player) => player.name).sort(), [
		"Alpha",
		"Beta",
	]);

	alpha.ws.send(
		JSON.stringify({
			v: 1,
			type: "input",
			seq: 1,
			tick: 1,
			turn: 0,
			thrust: true,
			fire: false,
		}),
	);
	const snapshot = await waitFor(
		alpha,
		(message) => message.type === "snapshot" && message.lastProcessedSeq >= 1,
	);
	if (snapshot.type !== "snapshot")
		throw new Error("expected a snapshot message");
	assert.ok(snapshot.tick > 0);
	assert.ok(snapshot.entities.some((entity) => entity.kind === "ship"));

	alpha.ws.send(
		JSON.stringify({ v: 1, type: "chat", text: "hello from lab 04" }),
	);
	const alphaChat = await waitFor(alpha, (message) => message.type === "chat");
	const betaChat = await waitFor(beta, (message) => message.type === "chat");
	if (alphaChat.type !== "chat" || betaChat.type !== "chat")
		throw new Error("expected chat messages");
	assert.equal(alphaChat.text, "hello from lab 04");
	assert.equal(betaChat.text, "hello from lab 04");

	const bad = await connect(port);
	bad.ws.send("{oops");
	const closeArgs = await once(bad.ws, "close");
	const badCode: unknown = closeArgs[0];
	assert.equal(badCode, CLOSE.INVALID_MESSAGE);

	alpha.ws.close();
	beta.ws.close();
	await until(async () => {
		const current = expectArray(
			await fetchJson(`${base}/api/rooms`),
			"current rooms",
		);
		return !current.some(
			(room: unknown) => expectRecord(room, "room").id === "training",
		);
	});

	const replayText = await until(async () => {
		const replays = expectArray(
			await fetchJson(`${base}/api/replays`),
			"replays",
		);
		for (const replay of replays) {
			const id = expectString(expectRecord(replay, "replay").id, "replay id");
			const text = await fetch(`${base}/api/replays/${id}`).then((response) =>
				response.text(),
			);
			if (text.includes("hello from lab 04")) return text;
		}
		return false;
	}, 2000);
	assert.match(replayText, /"text":"hello from lab 04"/);
});
