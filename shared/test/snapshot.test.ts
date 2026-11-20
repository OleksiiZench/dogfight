import { describe, expect, test } from "vitest";
import {
	entityFromSnapshot,
	serializeEntity,
	serializeEvent,
} from "../src/protocol/snapshot.ts";
import { Asteroid } from "../src/sim/asteroid.ts";
import { Bullet } from "../src/sim/bullet.ts";
import { Explosion } from "../src/sim/explosion.ts";
import { Pickup } from "../src/sim/pickup.ts";
import { Ship } from "../src/sim/ship.ts";
import { Vector2 } from "../src/sim/vector.ts";
import type { EntityData, GameEvent } from "../src/types.ts";
import { asEntityId, asSeq } from "../src/types.ts";

const arena = { width: 800, height: 600 };

function base(id: number) {
	return {
		id: asEntityId(id),
		x: 10,
		y: 20,
		vx: 1,
		vy: 2,
		angle: 0.5,
		age: 3,
		radius: 15,
		behaviors: [],
	};
}

const entities: EntityData[] = [
	{
		...base(1),
		kind: "ship",
		playerId: "p1",
		color: "#fff",
		hp: 100,
		maxHp: 100,
		fireDelay: 0.25,
		cooldown: 0,
		thrusting: true,
	},
	{
		...base(2),
		kind: "bullet",
		ownerId: "p2",
		sourceSeq: 7,
		ttl: 1,
		damage: 20,
	},
	{
		...base(3),
		kind: "asteroid",
		hp: 9,
		spin: 0.2,
		shape: [1, 0.8],
	},
	{ ...base(4), kind: "pickup", effect: "shield", ttl: 5 },
	{
		...base(5),
		kind: "explosion",
		color: "#f00",
		life: 0.8,
		particles: [{ x: 1, y: 2, vx: 3, vy: 4, ttl: 0.5 }],
	},
];

function fixture(index: number): EntityData {
	const value = entities[index];
	if (!value) throw new Error(`missing entity fixture ${index}`);
	return value;
}

describe("snapshot entity mapping", () => {
	test("restores every entity kind", () => {
		expect(
			entities.map((data) => entityFromSnapshot(data, arena)?.kind),
		).toEqual(["ship", "bullet", "asteroid", "pickup", "explosion"]);
	});

	test("restores timed and permanent behaviors", () => {
		const data: EntityData = {
			...fixture(0),
			behaviors: [
				{ name: "shield", remaining: 2 },
				{ name: "homing", remaining: null },
			],
		};
		const entity = entityFromSnapshot(data, arena);
		expect(entity?.behaviors.map((behavior) => behavior.name)).toEqual([
			"shield",
			"homing",
		]);
	});

	test("restores bullets without a source sequence", () => {
		const bullet = fixture(1);
		if (bullet.kind !== "bullet") throw new Error("expected bullet fixture");
		const data: EntityData = { ...bullet, sourceSeq: null };
		const entity = entityFromSnapshot(data, arena);
		expect(entity?.kind).toBe("bullet");
		if (entity?.kind !== "bullet") throw new Error("expected bullet");
		expect(entity.sourceSeq).toBeNull();
	});

	test("serializes ship state", () => {
		const entity = new Ship({
			id: asEntityId(1),
			playerId: "p1",
			pos: new Vector2(1, 2),
			color: "#fff",
		});
		expect(serializeEntity(entity)).toMatchObject({
			kind: "ship",
			playerId: "p1",
			hp: 100,
		});
	});

	test("serializes bullet state", () => {
		const entity = new Bullet({
			id: asEntityId(2),
			pos: new Vector2(),
			vel: new Vector2(),
			ownerId: "p2",
			sourceSeq: asSeq(7),
		});
		expect(serializeEntity(entity)).toMatchObject({
			kind: "bullet",
			sourceSeq: 7,
		});
	});

	test("serializes asteroid state", () => {
		const entity = new Asteroid({
			id: asEntityId(3),
			pos: new Vector2(),
			vel: new Vector2(),
			radius: 30,
			spin: 1,
			shape: [1, 2],
		});
		expect(serializeEntity(entity)).toMatchObject({
			kind: "asteroid",
			shape: [1, 2],
		});
	});

	test("serializes pickup state", () => {
		const entity = new Pickup({
			id: asEntityId(4),
			pos: new Vector2(),
			effect: "rapid",
		});
		expect(serializeEntity(entity)).toMatchObject({
			kind: "pickup",
			effect: "rapid",
		});
	});

	test("serializes explosion particles", () => {
		const entity = new Explosion({
			id: asEntityId(5),
			pos: new Vector2(),
			particles: [],
		});
		expect(serializeEntity(entity)).toMatchObject({
			kind: "explosion",
			particles: [],
		});
	});
});

describe("snapshot event mapping", () => {
	test("serializes positional events", () => {
		const events: GameEvent[] = [
			{ type: "fired", ownerId: "p1", pos: { x: 1, y: 2 }, angle: 0 },
			{ type: "hit", target: "ship", pos: { x: 1, y: 2 } },
			{ type: "exploded", pos: { x: 1, y: 2 }, color: "#fff" },
			{ type: "pickup", effect: "shield", pos: { x: 1, y: 2 } },
		];
		expect(events.map((event) => serializeEvent(event).type)).toEqual([
			"fired",
			"hit",
			"exploded",
			"pickup",
		]);
	});

	test("serializes entity and scalar events", () => {
		const events: GameEvent[] = [
			{
				type: "shipDestroyed",
				ship: {
					id: asEntityId(1),
					playerId: "p1",
					color: "#fff",
				},
				killerId: null,
			},
			{ type: "asteroidDestroyed", killerId: "p1" },
			{ type: "scoreChanged", scores: { p1: 1 } },
		];
		expect(events.map((event) => serializeEvent(event).type)).toEqual([
			"shipDestroyed",
			"asteroidDestroyed",
			"scoreChanged",
		]);
	});
});
