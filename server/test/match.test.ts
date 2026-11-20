import assert from "node:assert/strict";
import { once } from "node:events";
import { Vector2 } from "shared/sim/vector.ts";
import type { EntityData } from "shared/types.ts";
import { test } from "vitest";
import { Bot } from "../src/bots.ts";
import { Match } from "../src/match.ts";
import { Room } from "../src/rooms.ts";

const sleep = (ms: number): Promise<void> =>
	new Promise<void>((resolve) => setTimeout(resolve, ms));

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
	assert.ok(
		snapshot.entities.some((entity: EntityData) => entity.kind === "ship"),
	);
	assert.equal(match.getStats().tickRate, 30);
	match.close();
});

test("match adds and removes bots as simulation players", () => {
	const match = new Match(room(), { tickRate: 30, maxBots: 4 });
	assert.equal(match.setBots(3), 3);
	assert.deepEqual(
		[...match.game.players.keys()].filter((id) => id.startsWith("bot-")),
		["bot-1", "bot-2", "bot-3"],
	);
	assert.equal(match.getStats().bots, 3);
	assert.equal(match.setBots(1), 1);
	assert.deepEqual(
		[...match.game.players.keys()].filter((id) => id.startsWith("bot-")),
		["bot-1"],
	);
	match.close();
});

test("bot aims at the nearest enemy and fires", () => {
	const match = new Match(room(), { tickRate: 30 });
	match.game.addPlayer({
		id: "bot-1",
		name: "Bot 1",
		color: "#f87171",
		fireDelay: 0.16,
	});
	match.game.addPlayer({
		id: "enemy",
		name: "Enemy",
		color: "#4ade80",
	});
	const botShip = match.game.players.get("bot-1")?.ship;
	const enemyShip = match.game.players.get("enemy")?.ship;
	assert.ok(botShip);
	assert.ok(enemyShip);
	botShip.pos = new Vector2(200, 200);
	botShip.angle = 0;
	enemyShip.pos = new Vector2(500, 200);
	const intent = new Bot(1).update(match.game, 1);
	assert.equal(intent.fire, true);
	assert.ok(intent.turn > -0.05 && intent.turn < 0.05);
	assert.equal(intent.thrust, true);
	match.close();
});
