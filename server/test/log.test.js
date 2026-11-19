import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { attachMatchLog } from "../src/log/matchlog.js";
import { readNdjson } from "../src/log/replay.js";
import { Room } from "../src/rooms.js";

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

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

		const events = [];
		for await (const event of readNdjson(log.filePath)) events.push(event);
		assert.deepEqual(
			events.map((event) => event.type),
			["join", "chat"],
		);
		assert.equal(events[1].text, "привіт");
		assert.equal(events[1].room, "training");
	} finally {
		await rm(logDir, { recursive: true, force: true });
	}
});
