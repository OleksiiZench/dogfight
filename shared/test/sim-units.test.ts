import { describe, expect, test } from "vitest";
import { createRng } from "../src/math.ts";
import { Asteroid } from "../src/sim/asteroid.ts";
import { EFFECTS, homing, timedEffect } from "../src/sim/behaviors.ts";
import { Bullet } from "../src/sim/bullet.ts";
import { findCollisions } from "../src/sim/collision.ts";
import { Entity } from "../src/sim/entity.ts";
import { Explosion } from "../src/sim/explosion.ts";
import { Pickup } from "../src/sim/pickup.ts";
import { particlePool } from "../src/sim/pool.ts";
import { resolveCollision } from "../src/sim/rules.ts";
import { Ship } from "../src/sim/ship.ts";
import { Vector2 } from "../src/sim/vector.ts";
import { World } from "../src/sim/world.ts";
import { asEntityId, asSeq } from "../src/types.ts";

const arena = { width: 1000, height: 600 };

function ship(id = 1, x = 100, y = 100): Ship {
	return new Ship({
		id: asEntityId(id),
		playerId: "p1",
		pos: new Vector2(x, y),
	});
}

function bullet(id = 2, owner = "p2", damage = 20): Bullet {
	return new Bullet({
		id: asEntityId(id),
		pos: new Vector2(100, 100),
		vel: new Vector2(1, 0),
		ownerId: owner,
		damage,
	});
}

function asteroid(id = 3, hp = 10): Asteroid {
	return new Asteroid({
		id: asEntityId(id),
		pos: new Vector2(100, 100),
		vel: new Vector2(),
		radius: 30,
		spin: 0,
		shape: [1, 1, 1],
		hp,
	});
}

function pickup(id = 4): Pickup {
	return new Pickup({
		id: asEntityId(id),
		pos: new Vector2(100, 100),
		effect: "repair",
	});
}

function world(): World {
	return new World({ rng: createRng(1), arena });
}

describe("collision detection", () => {
	test("finds overlapping solid entities", () => {
		const pairs = findCollisions([ship(), asteroid()]);
		expect(pairs).toHaveLength(1);
	});

	test("ignores touching circles", () => {
		const far = ship(1, 200, 100);
		expect(findCollisions([far, asteroid(3)])).toHaveLength(0);
	});

	test("ignores dead entities", () => {
		const dead = ship();
		dead.kill();
		expect(findCollisions([dead, asteroid()])).toHaveLength(0);
	});

	test("ignores non-solid entities", () => {
		const explosion = new Explosion({
			id: asEntityId(9),
			pos: new Vector2(100, 100),
			particles: [],
		});
		expect(findCollisions([ship(), explosion])).toHaveLength(0);
	});

	test("finds the only overlap among many separated entities", () => {
		const rocks = Array.from({ length: 17 }, (_, index) => {
			const rock = asteroid(100 + index, 0);
			rock.pos = new Vector2(40 + index * 80, 50);
			return rock;
		});
		const first = asteroid(300, 0);
		first.pos = new Vector2(1400, 400);
		const second = asteroid(301, 0);
		second.pos = new Vector2(1420, 400);
		expect(findCollisions([...rocks, first, second])).toHaveLength(1);
	});
});

describe("entity behavior", () => {
	test("savePrevious stores position and angle", () => {
		const entity = ship();
		entity.pos = new Vector2(120, 140);
		entity.angle = 1;
		entity.savePrevious();
		expect(entity.prevPos).toEqual({ x: 120, y: 140 });
		expect(entity.prevPos).not.toBe(entity.pos);
		expect(entity.prevAngle).toBe(1);
	});

	test("update integrates velocity and age", () => {
		const entity = new Entity({
			id: asEntityId(20),
			kind: "bullet",
			pos: new Vector2(0, 0),
			vel: new Vector2(10, 0),
		});
		entity.update(0.5);
		expect(entity.pos.x).toBe(5);
		expect(entity.age).toBe(0.5);
	});

	test("addBehavior replaces by name", () => {
		const entity = ship();
		entity.addBehavior(timedEffect("shield", 5));
		entity.addBehavior(timedEffect("shield", 2));
		expect(entity.behaviors).toHaveLength(1);
		expect(entity.behaviors[0]?.remaining).toBe(2);
	});

	test("runBehaviors removes finished behaviors", () => {
		const entity = ship();
		entity.addBehavior(timedEffect("shield", 0.1));
		entity.runBehaviors(0.2);
		expect(entity.hasBehavior("shield")).toBe(false);
	});

	test("renderPos interpolates", () => {
		const entity = ship();
		entity.prevPos = new Vector2(0, 0);
		entity.pos = new Vector2(10, 20);
		expect(entity.renderPos(0.5)).toMatchObject({ x: 5, y: 10 });
		expect(entity.renderPos(0.5)).toBe(entity.renderPos(0.5));
	});

	test("renderPos skips wrap jumps", () => {
		const entity = ship();
		entity.prevPos = new Vector2(10, 10);
		entity.pos = new Vector2(990, 10);
		expect(entity.renderPos(0.5)).toBe(entity.pos);
	});

	test("renderAngle interpolates along shortest arc", () => {
		const entity = ship();
		entity.prevAngle = 3;
		entity.angle = -3;
		expect(entity.renderAngle(0.5)).toBeCloseTo(Math.PI);
	});

	test("timedEffect exposes remaining", () => {
		const effect = timedEffect("rapid", 2);
		expect(effect.remaining).toBe(2);
		effect.update(ship(), 1);
		expect(effect.remaining).toBe(1);
		expect(effect.done).toBe(false);
	});

	test("homing ignores stationary owners", () => {
		const behavior = homing({ canTarget: () => true });
		const entity = ship();
		entity.vel = new Vector2();
		const before = entity.vel;
		behavior.update(entity, 1 / 60);
		expect(entity.vel).toBe(before);
	});

	test("homing steers towards the nearest target", () => {
		const behavior = homing({ canTarget: () => true, turnRate: 1 });
		const entity = ship();
		entity.vel = new Vector2(1, 0);
		const target = ship(30, 100, 200);
		const testWorld = world();
		testWorld.spawn(entity);
		testWorld.spawn(target);
		behavior.update(entity, 0.5);
		expect(entity.vel.y).toBeGreaterThan(0);
	});

	test("EFFECTS applies shield, rapid, homing and repair", () => {
		const entity = ship();
		entity.damage(40);
		expect(entity.hp).toBe(60);
		for (const effect of ["shield", "rapid", "homing"] as const)
			EFFECTS.get(effect)?.apply(entity);
		expect(entity.hasBehavior("shield")).toBe(true);
		expect(entity.hasBehavior("rapid")).toBe(true);
		expect(entity.hasBehavior("homingShots")).toBe(true);
		EFFECTS.get("repair")?.apply(entity);
		expect(entity.hp).toBe(100);
	});
});

describe("entity classes", () => {
	test("ship damage respects invulnerability", () => {
		const entity = ship();
		entity.addBehavior(timedEffect("shield", 5));
		expect(entity.damage(30)).toBe(false);
		expect(entity.hp).toBe(100);
	});

	test("ship damage kills at zero", () => {
		const entity = ship();
		expect(entity.damage(100)).toBe(true);
		expect(entity.alive).toBe(false);
	});

	test("ship fire respects cooldown and rapid", () => {
		const testWorld = world();
		const entity = ship();
		testWorld.spawn(entity);
		expect(entity.fire(asSeq(1))).toBe(true);
		expect(entity.fire()).toBe(false);
		entity.cooldown = 0;
		entity.addBehavior(timedEffect("rapid", 5));
		expect(entity.fire()).toBe(true);
		expect(entity.cooldown).toBeCloseTo(entity.fireDelay / 3);
	});

	test("ship fire with homingShots adds homing behavior", () => {
		const testWorld = world();
		const entity = ship();
		entity.addBehavior(timedEffect("homingShots", 5));
		testWorld.spawn(entity);
		entity.fire();
		const fired = [...testWorld].find((item) => item.kind === "bullet");
		expect(fired?.hasBehavior("homing")).toBe(true);
	});

	test("ship control thrusts and fires", () => {
		const testWorld = world();
		const entity = ship();
		testWorld.spawn(entity);
		entity.control({ turn: 0.5, thrust: true, fire: true }, 0.1);
		expect(entity.thrusting).toBe(true);
		expect(entity.vel.length()).toBeGreaterThan(0);
		expect([...testWorld].some((item) => item.kind === "bullet")).toBe(true);
	});

	test("ship update clamps speed and decrements cooldown", () => {
		const entity = ship();
		entity.vel = new Vector2(1000, 0);
		entity.cooldown = 1;
		entity.update(0.1);
		expect(entity.vel.length()).toBeLessThanOrEqual(450);
		expect(entity.cooldown).toBeCloseTo(0.9);
	});

	test("bullet expires after ttl", () => {
		const item = bullet(2, "p1", 10);
		item.ttl = 0.05;
		item.update(0.1);
		expect(item.alive).toBe(false);
	});

	test("pickup expires after ttl", () => {
		const item = pickup();
		item.ttl = 0.05;
		item.update(0.1);
		expect(item.alive).toBe(false);
	});

	test("asteroid damage kills at zero", () => {
		const item = asteroid(3, 5);
		expect(item.damage(5)).toBe(true);
		expect(item.alive).toBe(false);
		expect(item.hp).toBe(0);
	});

	test("asteroid bounces off arena edges", () => {
		const item = asteroid(3);
		item.pos = new Vector2(10, 300);
		item.vel = new Vector2(-100, 0);
		item.handleEdges();
		expect(item.vel.x).toBeGreaterThan(0);
	});

	test("explosion updates particles and dies", () => {
		const item = new Explosion({
			id: asEntityId(11),
			pos: new Vector2(),
			rng: createRng(3),
			count: 3,
		});
		item.update(2);
		item.update(2);
		expect(item.alive).toBe(false);
		expect(item.particles).toHaveLength(3);
	});
});

describe("collision resolution", () => {
	test("bullet hits ship from either order", () => {
		const testWorld = world();
		const target = ship(1);
		const projectile = bullet(2, "p2");
		testWorld.spawn(target);
		testWorld.spawn(projectile);
		resolveCollision(projectile, target, testWorld);
		expect(projectile.alive).toBe(false);
		expect(target.hp).toBe(80);
		resolveCollision(target, bullet(5, "p2"), testWorld);
		expect(target.hp).toBe(60);
	});

	test("bullet ignores its owner", () => {
		const testWorld = world();
		const target = ship(1);
		const projectile = bullet(2, "p1");
		resolveCollision(projectile, target, testWorld);
		expect(target.hp).toBe(100);
	});

	test("bullet hits asteroid from either order", () => {
		const testWorld = world();
		const rock = asteroid(3, 10);
		testWorld.spawn(rock);
		resolveCollision(bullet(2), rock, testWorld);
		expect(rock.hp).toBe(-10);
		const second = asteroid(6, 10);
		testWorld.spawn(second);
		resolveCollision(second, bullet(7), testWorld);
		expect(second.hp).toBe(-10);
	});

	test("ship hits asteroid and gains invulnerability", () => {
		const testWorld = world();
		const target = ship(1);
		const rock = asteroid(3, 100);
		testWorld.spawn(target);
		testWorld.spawn(rock);
		resolveCollision(target, rock, testWorld);
		expect(target.hp).toBe(75);
		expect(target.hasBehavior("invuln")).toBe(true);
		resolveCollision(rock, target, testWorld);
		expect(target.hp).toBe(75);
	});

	test("ship takes pickup from either order", () => {
		const testWorld = world();
		const target = ship(1);
		target.damage(50);
		const item = pickup();
		testWorld.spawn(target);
		testWorld.spawn(item);
		resolveCollision(item, target, testWorld);
		expect(item.alive).toBe(false);
		expect(target.hp).toBe(90);
		const second = pickup(8);
		resolveCollision(target, second, testWorld);
		expect(second.alive).toBe(false);
	});

	test("ignores collisions involving dead entities", () => {
		const testWorld = world();
		const target = ship(1);
		const deadBullet = bullet(2, "p2");
		deadBullet.kill();
		resolveCollision(deadBullet, target, testWorld);
		expect(target.hp).toBe(100);

		const deadShip = ship(3);
		deadShip.kill();
		resolveCollision(bullet(4, "p2"), deadShip, testWorld);

		const rock = asteroid(5, 10);
		rock.kill();
		resolveCollision(bullet(6, "p2"), rock, testWorld);
		resolveCollision(ship(7), rock, testWorld);

		const item = pickup(8);
		item.kill();
		resolveCollision(ship(9), item, testWorld);
		expect(item.alive).toBe(false);
	});

	test("asteroid can destroy a ship", () => {
		const testWorld = world();
		const target = ship(1);
		const rock = asteroid(3, 100);
		target.damage(75);
		testWorld.spawn(target);
		testWorld.spawn(rock);
		resolveCollision(target, rock, testWorld);
		expect(target.alive).toBe(false);
	});
});

describe("particle pool", () => {
	test("explosion returns particles to the pool", () => {
		particlePool.clear();
		const explosion = new Explosion({
			id: asEntityId(44),
			pos: new Vector2(100, 100),
			rng: createRng(1),
			count: 4,
		});
		expect(particlePool.size).toBe(0);
		explosion.kill();
		expect(explosion.particles).toHaveLength(4);
		expect(particlePool.size).toBe(4);
		const reused = particlePool.acquire();
		expect(reused.pos).toBeInstanceOf(Vector2);
	});
});
