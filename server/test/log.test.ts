import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { attachMatchLog } from "../src/log/matchlog.ts";
import { readNdjson } from "../src/log/replay.ts";
import { Room } from "../src/rooms.ts";

const sleep = (ms: number): Promise<void> =>
	new Promise<void>((resolve) => setTimeout(resolve, ms));

const isRecord = (value: unknown): value is Record<string, unknown> =>
	Boolean(value) && typeof value === "object" && !Array.isArray(value);

interface LogEvent {
	type?: unknown;
	text?: unknown;
	room?: unknown;
}

test("room events become NDJSON and replay back", async () => {
	const logDir = await mkdtemp(join(tmpdir(), "dogfight-log-"));
	try {
		const room = new Room({
			id: "training",
			name: "Training",
			seed: 1,
			arena: { width: 1200, height: 700 },
			asteroidTarget: 3,
			capacity: 2,
		});
		const log = attachMatchLog(room, { logDir });
		room.join({ id: "p1", name: "Alpha" });
		room.chat("p1", "привіт");
		await sleep(30);
		await log.close();

		const events: LogEvent[] = [];
		for await (const value of readNdjson(log.filePath)) {
			if (!isRecord(value)) throw new Error("log event has to be an object");
			events.push(value);
		}
		assert.deepEqual(
			events.map((event) => event.type),
			["join", "chat"],
		);
		const chat = events[1];
		assert.ok(chat);
		assert.equal(chat.text, "привіт");
		assert.equal(chat.room, "training");
	} finally {
		await rm(logDir, { recursive: true, force: true });
	}
});
