import assert from "node:assert/strict";
import { test } from "node:test";
import type { Arena, EntityData, PlayerId, Snapshot } from "shared/types.ts";
import { MatchView } from "../src/net/match.ts";

const arena: Arena = { width: 1200, height: 700 };

function ship(
	id: number,
	x: number,
	playerId: PlayerId = `p${id}`,
): EntityData {
	return {
		id,
		kind: "ship",
		x,
		y: 100,
		vx: 0,
		vy: 0,
		angle: 0,
		age: 0,
		radius: 22,
		behaviors: [],
		playerId,
		color: "#4ade80",
		hp: 100,
		maxHp: 100,
		fireDelay: 0.25,
		cooldown: 0,
		thrusting: false,
	};
}

function snapshot(tick: number, entities: EntityData[]): Snapshot {
	return { type: "snapshot", tick, arena, players: [], entities };
}

function viewWith(frames: EntityData[][]): MatchView {
	const view = new MatchView({ arena, interpolationDelayMs: 50 });
	frames.forEach((entities, index) => {
		view.applySnapshot(snapshot(index + 1, entities));
	});
	const first = view.history[0];
	const second = view.history[1];
	if (!first || !second) throw new Error("expected two snapshots");
	first.receivedAt = 0;
	second.receivedAt = 100;
	return view;
}

test("remote entities interpolate between snapshots", () => {
	const view = viewWith([[ship(1, 100)], [ship(1, 200)]]);
	const [entity] = view.interpolatedEntities(100);
	if (!entity) throw new Error("expected an interpolated entity");
	assert.ok(Math.abs(entity.pos.x - 150) < 1e-6);
});

test("interpolation handles wrap-around and entity churn", () => {
	const wrapped = viewWith([[ship(1, 1150)], [ship(1, 50)]]);
	const [wrappedEntity] = wrapped.interpolatedEntities(100);
	if (!wrappedEntity) throw new Error("expected an interpolated entity");
	assert.ok(Math.abs(wrappedEntity.pos.x) < 1e-6);

	const churn = viewWith([[ship(1, 100)], [ship(2, 200)]]);
	assert.deepEqual(
		churn.interpolatedEntities(100).map((entity) => entity.id),
		[2],
	);
});
