import assert from "node:assert/strict";
import { once } from "node:events";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import WebSocket from "ws";
import { loadConfig } from "../src/config.js";
import { createApp } from "../src/index.js";

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function connect(port) {
	const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`);
	const messages = [];
	ws.on("message", (data) => messages.push(JSON.parse(data.toString())));
	await once(ws, "open");
	return { ws, messages };
}

async function waitFor(client, predicate, timeoutMs = 1500) {
	const existing = client.messages.find(predicate);
	if (existing) return existing;
	return new Promise((resolve, reject) => {
		const timer = setTimeout(() => {
			cleanup();
			reject(new Error("timed out waiting for message"));
		}, timeoutMs);
		const handler = (data) => {
			const message = JSON.parse(data.toString());
			if (predicate(message)) {
				cleanup();
				resolve(message);
			}
		};
		const cleanup = () => {
			clearTimeout(timer);
			client.ws.off("message", handler);
		};
		client.ws.on("message", handler);
	});
}

async function until(check, timeoutMs = 1500) {
	const deadline = Date.now() + timeoutMs;
	while (Date.now() < deadline) {
		const value = await check();
		if (value) return value;
		await sleep(25);
	}
	throw new Error("condition was not met in time");
}

test("http, rooms, chat and replay work together", async (t) => {
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
	t.after(async () => {
		await app.close();
		await rm(logDir, { recursive: true, force: true });
	});
	await app.listen();
	const port = app.server.address().port;
	const base = `http://127.0.0.1:${port}`;

	const health = await fetch(`${base}/health`).then((response) =>
		response.json(),
	);
	assert.equal(health.ok, true);
	assert.equal(health.rooms, 3);
	const stats = await fetch(`${base}/api/stats`).then((response) =>
		response.json(),
	);
	assert.equal(stats.matches.length, 3);
	assert.equal(stats.matches[0].tickRate, 30);
	const rooms = await fetch(`${base}/api/rooms`).then((response) =>
		response.json(),
	);
	assert.equal(rooms.length, 3);

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
	assert.ok(snapshot.tick > 0);
	assert.ok(snapshot.entities.some((entity) => entity.kind === "ship"));

	alpha.ws.send(
		JSON.stringify({ v: 1, type: "chat", text: "hello from lab 04" }),
	);
	const alphaChat = await waitFor(alpha, (message) => message.type === "chat");
	const betaChat = await waitFor(beta, (message) => message.type === "chat");
	assert.equal(alphaChat.text, "hello from lab 04");
	assert.equal(betaChat.text, "hello from lab 04");

	const bad = await connect(port);
	bad.ws.send("{oops");
	const [badCode] = await once(bad.ws, "close");
	assert.equal(badCode, 4001);

	alpha.ws.close();
	beta.ws.close();
	await until(async () => {
		const current = await fetch(`${base}/api/rooms`).then((response) =>
			response.json(),
		);
		return !current.some((room) => room.id === "training");
	});

	const replayText = await until(async () => {
		const replays = await fetch(`${base}/api/replays`).then((response) =>
			response.json(),
		);
		for (const replay of replays) {
			const text = await fetch(`${base}/api/replays/${replay.id}`).then(
				(response) => response.text(),
			);
			if (text.includes("hello from lab 04")) return text;
		}
		return false;
	}, 2000);
	assert.match(replayText, /"text":"hello from lab 04"/);
});
