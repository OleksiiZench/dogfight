import type { EntityData, Snapshot } from "shared/types.ts";
import { describe, expect, test } from "vitest";
import {
	pendingAfterAck,
	reconcileBulletKeys,
	wrappedDistance,
} from "../src/net/reconcile.ts";

const arena = { width: 1000, height: 600 };

function bullet(
	id: number,
	sourceSeq: number | null,
	ownerId = "p1",
): EntityData {
	return {
		id,
		kind: "bullet",
		x: 0,
		y: 0,
		vx: 0,
		vy: 0,
		angle: 0,
		age: 0,
		radius: 4,
		behaviors: [],
		ownerId,
		sourceSeq,
		ttl: 1,
		damage: 20,
	};
}

function snapshot(entities: EntityData[], seq = 0): Snapshot {
	return {
		type: "snapshot",
		tick: 1,
		arena,
		players: [],
		entities,
		events: [],
		lastProcessedSeq: seq,
	};
}

describe("pure reconciliation helpers", () => {
	test("wrappedDistance uses the short path across edges", () => {
		expect(
			wrappedDistance({ x: 10, y: 10 }, { x: 990, y: 10 }, arena),
		).toBeCloseTo(20);
	});

	test("wrappedDistance works for normal distances", () => {
		expect(
			wrappedDistance({ x: 100, y: 100 }, { x: 140, y: 115 }, arena),
		).toBeCloseTo(Math.sqrt(40 * 40 + 15 * 15));
	});

	test("pendingAfterAck drops acknowledged inputs", () => {
		const pending = [{ seq: 1 }, { seq: 2 }, { seq: 3 }];
		expect(pendingAfterAck(pending, 1)).toEqual([{ seq: 2 }, { seq: 3 }]);
	});

	test("bullet reconciliation confirms owned bullets", () => {
		const result = reconcileBulletKeys(
			snapshot([bullet(10, 1), bullet(11, null, "p2")], 1),
			"p1",
			1,
			[1],
			[],
		);
		expect(result.confirmed.map((item) => item.key)).toEqual([1]);
		expect(result.predictedToDelete).toContain(1);
	});

	test("bullet reconciliation deletes stale confirmed bullets", () => {
		const result = reconcileBulletKeys(snapshot([], 5), "p1", 5, [], [3, 9]);
		expect(result.confirmedToDelete).toEqual([3, 9]);
	});

	test("bullet reconciliation drops predicted bullets below ack", () => {
		const result = reconcileBulletKeys(snapshot([], 7), "p1", 7, [5, 7, 8], []);
		expect(result.predictedToDelete).toEqual([5, 7]);
	});
});
