import { describe, expect, test } from "vitest";
import { createRng } from "../src/math.ts";
import { Ship } from "../src/sim/ship.ts";
import { Vector2 } from "../src/sim/vector.ts";
import { createStaticWorld, World } from "../src/sim/world.ts";
import { asEntityId } from "../src/types.ts";

const arena = { width: 800, height: 600 };

function world(): World {
	return new World({ rng: createRng(5), arena, idStart: 10 });
}

function ship(id = 1): Ship {
	return new Ship({
		id: asEntityId(id),
		playerId: "p1",
		pos: new Vector2(100, 100),
	});
}

describe("World", () => {
	test("nextId increments from idStart", () => {
		expect(world().nextId()).toBe(10);
	});

	test("spawn attaches world and registers entity", () => {
		const testWorld = world();
		const entity = ship();
		expect(testWorld.spawn(entity)).toBe(entity);
		expect(entity.world).toBe(testWorld);
		expect(testWorld.get(entity.id)).toBe(entity);
		expect(testWorld.size).toBe(1);
	});

	test("get returns undefined for unknown id", () => {
		expect(world().get(asEntityId(999))).toBeUndefined();
	});

	test("iterator yields spawned entities", () => {
		const testWorld = world();
		testWorld.spawn(ship(1));
		testWorld.spawn(ship(2));
		expect([...testWorld].map((entity) => entity.id)).toEqual([1, 2]);
	});

	test("ofKind filters entities", () => {
		const testWorld = world();
		testWorld.spawn(ship(1));
		testWorld.spawn(ship(2));
		expect([...testWorld.ofKind("ship")]).toHaveLength(2);
		expect([...testWorld.ofKind("bullet")]).toHaveLength(0);
	});

	test("despawn kills and step sweeps dead entities", () => {
		const testWorld = world();
		const entity = ship();
		testWorld.spawn(entity);
		testWorld.despawn(entity.id);
		expect(entity.alive).toBe(false);
		expect(testWorld.size).toBe(1);
		testWorld.step(1 / 30);
		expect(testWorld.size).toBe(0);
		expect(entity.world).toBeNull();
	});

	test("drainEvents returns then clears events", () => {
		const testWorld = world();
		testWorld.emit({ type: "asteroidDestroyed", killerId: null });
		expect(testWorld.drainEvents()).toHaveLength(1);
		expect(testWorld.drainEvents()).toHaveLength(0);
	});

	test("step applies intents to ships", () => {
		const testWorld = world();
		const entity = ship();
		testWorld.spawn(entity);
		testWorld.step(
			0.1,
			new Map([[entity.id, { turn: 1, thrust: true, fire: false }]]),
		);
		expect(entity.angle).not.toBe(0);
		expect(entity.vel.length()).toBeGreaterThan(0);
	});

	test("step ignores intents for non-ships", () => {
		const testWorld = world();
		const entity = ship();
		testWorld.spawn(entity);
		testWorld.step(
			0.1,
			new Map([[asEntityId(999), { turn: 1, thrust: true, fire: false }]]),
		);
		expect(entity.angle).toBeCloseTo(-Math.PI / 2);
	});

	test("createStaticWorld exposes read-only facilities", () => {
		const staticWorld = createStaticWorld(arena);
		const entity = ship();
		expect(staticWorld.spawn(entity)).toBe(entity);
		expect([...staticWorld]).toEqual([entity]);
		expect([...staticWorld.ofKind("ship")]).toEqual([entity]);
		expect(staticWorld.nextId()).toBe(0);
		expect(staticWorld.rng.next()).toBe(0);
		expect(staticWorld.rng.range(2, 5)).toBe(2);
		expect(staticWorld.rng.pick(["a"])).toBe("a");
		staticWorld.emit({ type: "asteroidDestroyed", killerId: null });
	});
});
