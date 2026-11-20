import assert from "node:assert/strict";
import { test } from "vitest";
import { Game } from "../src/sim/game.ts";
import type { EntityId, Intent } from "../src/types.ts";

function hash(game: Game): number {
	let value = 2166136261;
	const entities = [...game.world].sort((a, b) => a.id - b.id);
	for (const entity of entities) {
		const parts = [
			entity.id,
			entity.kind,
			entity.pos.x,
			entity.pos.y,
			entity.vel.x,
			entity.vel.y,
			entity.angle,
		];
		for (const part of parts) {
			const text =
				typeof part === "string"
					? part
					: Number.isInteger(part)
						? String(part)
						: part.toFixed(6);
			for (let i = 0; i < text.length; i++) {
				value ^= text.charCodeAt(i);
				value = Math.imul(value, 16777619) >>> 0;
			}
		}
	}
	return value >>> 0;
}

function run(seed: number): number {
	const game = new Game({
		seed,
		arena: { width: 1200, height: 700 },
		asteroidTarget: 3,
	});
	game.addPlayer({ id: "p1", name: "Alpha", color: "#4ade80" });
	game.start();
	const player = game.players.get("p1");
	if (!player || player.shipId === null) throw new Error("missing player ship");
	const shipId: EntityId = player.shipId;
	const intent: Intent = { turn: 0.2, thrust: true, fire: true };
	const intents = new Map<EntityId, Intent>([[shipId, intent]]);
	for (let i = 0; i < 1000; i++) game.step(1 / 60, intents);
	return hash(game);
}

test("shared simulation imports in Node and is deterministic", () => {
	assert.equal(run(7), run(7));
	assert.notEqual(run(7), run(11));
});
