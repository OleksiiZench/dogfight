import { Asteroid } from "../sim/asteroid.js";
import { timedEffect } from "../sim/behaviors.js";
import { Bullet } from "../sim/bullet.js";
import { Explosion } from "../sim/explosion.js";
import { Pickup } from "../sim/pickup.js";
import { Ship } from "../sim/ship.js";
import { Vector2 } from "../sim/vector.js";

function point(value) {
	return { x: value.x, y: value.y };
}

function behaviorsOf(entity) {
	return entity.behaviors.map((behavior) => ({
		name: behavior.name,
		remaining: behavior.remaining ?? null,
	}));
}

function restoreBehavior(data) {
	if (data.remaining === null) {
		return { name: data.name, done: false, update() {} };
	}
	return timedEffect(data.name, data.remaining);
}

function attach(entity, data, arena) {
	entity.pos = new Vector2(data.x, data.y);
	entity.prevPos = new Vector2(data.x, data.y);
	entity.vel = new Vector2(data.vx, data.vy);
	entity.angle = data.angle;
	entity.prevAngle = data.angle;
	entity.age = data.age ?? 0;
	entity.world = { arena };
	for (const behavior of data.behaviors ?? [])
		entity.addBehavior(restoreBehavior(behavior));
	return entity;
}

export function serializeEntity(entity) {
	const data = {
		id: entity.id,
		kind: entity.kind,
		x: entity.pos.x,
		y: entity.pos.y,
		vx: entity.vel.x,
		vy: entity.vel.y,
		angle: entity.angle,
		age: entity.age,
		radius: entity.radius,
		behaviors: behaviorsOf(entity),
	};
	if (entity.kind === "ship") {
		Object.assign(data, {
			playerId: entity.playerId,
			color: entity.color,
			hp: entity.hp,
			maxHp: entity.maxHp,
			fireDelay: entity.fireDelay,
			cooldown: entity.cooldown,
			thrusting: entity.thrusting,
		});
	} else if (entity.kind === "bullet") {
		Object.assign(data, {
			ownerId: entity.ownerId,
			ttl: entity.ttl,
			damage: entity.damage,
		});
	} else if (entity.kind === "asteroid") {
		Object.assign(data, {
			hp: entity.hp,
			spin: entity.spin,
			shape: entity.shape,
		});
	} else if (entity.kind === "pickup") {
		Object.assign(data, { effect: entity.effect, ttl: entity.ttl });
	} else if (entity.kind === "explosion") {
		Object.assign(data, {
			color: entity.color,
			life: entity.life,
			particles: entity.particles.map((particle) => ({
				x: particle.pos.x,
				y: particle.pos.y,
				vx: particle.vel.x,
				vy: particle.vel.y,
				ttl: particle.ttl,
			})),
		});
	}
	return data;
}

export function entityFromSnapshot(data, arena) {
	if (data.kind === "ship") {
		return attach(
			new Ship({
				id: data.id,
				playerId: data.playerId,
				pos: new Vector2(data.x, data.y),
				angle: data.angle,
				hp: data.hp,
				color: data.color,
				maxHp: data.maxHp,
				fireDelay: data.fireDelay,
				cooldown: data.cooldown,
				thrusting: data.thrusting,
			}),
			data,
			arena,
		);
	}
	if (data.kind === "bullet") {
		return attach(
			new Bullet({
				id: data.id,
				pos: new Vector2(data.x, data.y),
				vel: new Vector2(data.vx, data.vy),
				ownerId: data.ownerId,
				ttl: data.ttl,
				damage: data.damage,
			}),
			data,
			arena,
		);
	}
	if (data.kind === "asteroid") {
		return attach(
			new Asteroid({
				id: data.id,
				pos: new Vector2(data.x, data.y),
				vel: new Vector2(data.vx, data.vy),
				radius: data.radius,
				spin: data.spin,
				shape: data.shape,
				hp: data.hp,
			}),
			data,
			arena,
		);
	}
	if (data.kind === "pickup") {
		return attach(
			new Pickup({
				id: data.id,
				pos: new Vector2(data.x, data.y),
				effect: data.effect,
				ttl: data.ttl,
			}),
			data,
			arena,
		);
	}
	if (data.kind === "explosion") {
		return attach(
			new Explosion({
				id: data.id,
				pos: new Vector2(data.x, data.y),
				color: data.color,
				life: data.life,
				particles: (data.particles ?? []).map((particle) => ({
					pos: new Vector2(particle.x, particle.y),
					vel: new Vector2(particle.vx, particle.vy),
					ttl: particle.ttl,
				})),
			}),
			data,
			arena,
		);
	}
	return null;
}

export function serializeEvent(event) {
	const result = { ...event };
	for (const [key, value] of Object.entries(result)) {
		if (value instanceof Vector2) result[key] = point(value);
		else if (
			value &&
			typeof value === "object" &&
			"id" in value &&
			"playerId" in value
		) {
			result[key] = {
				id: value.id,
				playerId: value.playerId,
				color: value.color,
			};
		}
	}
	if (result.scores instanceof Map)
		result.scores = Object.fromEntries(result.scores);
	return result;
}
