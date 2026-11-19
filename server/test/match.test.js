import assert from "node:assert/strict";
import { once } from "node:events";
import { test } from "node:test";
import { Match } from "../src/match.js";
import { Room } from "../src/rooms.js";

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function room() {
	return new Room({
		id: "training",
		name: "Training",
		seed: 7,
		arena: { width: 1200, height: 700 },
		asteroidTarget: 3,
		capacity: 2,
	});
}

test("match ticks at the configured rate and records the last input seq", async () => {
	const match = new Match(room(), { tickRate: 30 });
	match.start();
	const player = match.room.join({ id: "p1", name: "Alpha" });
	match.applyInput(player.id, {
		type: "input",
		seq: 42,
		tick: 1,
		turn: 2,
		thrust: true,
		fire: false,
	});
	await Promise.race([once(match, "tick"), sleep(300)]);
	await sleep(80);
	const snapshot = match.snapshotFor(player.id);
	assert.ok(match.tick >= 2);
	assert.equal(match.lastSeq.get(player.id), 42);
	assert.equal(snapshot.lastProcessedSeq, 42);
	assert.ok(snapshot.entities.some((entity) => entity.kind === "ship"));
	assert.equal(match.getStats().tickRate, 30);
	match.close();
});
