import { Asteroid } from "../sim/asteroid.ts";
import type { Behavior } from "../sim/behaviors.ts";
import { timedEffect } from "../sim/behaviors.ts";
import { Bullet } from "../sim/bullet.ts";
import type { AnyEntity } from "../sim/entity.ts";
import { Explosion } from "../sim/explosion.ts";
import { Pickup } from "../sim/pickup.ts";
import { Ship } from "../sim/ship.ts";
import { Vector2 } from "../sim/vector.ts";
import { createStaticWorld } from "../sim/world.ts";
import type {
	Arena,
	BehaviorSnapshot,
	EntityData,
	GameEvent,
} from "../types.ts";
import { asEntityId, asSeq, assertNever } from "../types.ts";

function point(value: { x: number; y: number }) {
	return { x: value.x, y: value.y };
}

function behaviorsOf(entity: AnyEntity): BehaviorSnapshot[] {
	return entity.behaviors.map((behavior) => ({
		name: behavior.name,
		remaining: behavior.remaining ?? null,
	}));
}

function restoreBehavior(data: BehaviorSnapshot): Behavior {
	if (data.remaining === null) {
		return { name: data.name, done: false, update() {} };
	}
	return timedEffect(data.name, data.remaining);
}

function attach<T extends AnyEntity>(
	entity: T,
	data: EntityData,
	arena: Arena,
): T {
	entity.pos = new Vector2(data.x, data.y);
	entity.prevPos = new Vector2(data.x, data.y);
	entity.vel = new Vector2(data.vx, data.vy);
	entity.angle = data.angle;
	entity.prevAngle = data.angle;
	entity.age = data.age ?? 0;
	entity.world = createStaticWorld(arena);
	for (const behavior of data.behaviors ?? [])
		entity.addBehavior(restoreBehavior(behavior));
	return entity;
}

export function serializeEntity(entity: AnyEntity): EntityData {
	const base = {
		id: entity.id,
		x: entity.pos.x,
		y: entity.pos.y,
		vx: entity.vel.x,
		vy: entity.vel.y,
		angle: entity.angle,
		age: entity.age,
		radius: entity.radius,
		behaviors: behaviorsOf(entity),
	};
	switch (entity.kind) {
		case "ship":
			return {
				...base,
				kind: "ship",
				playerId: entity.playerId,
				color: entity.color,
				hp: entity.hp,
				maxHp: entity.maxHp,
				fireDelay: entity.fireDelay,
				cooldown: entity.cooldown,
				thrusting: entity.thrusting,
			};
		case "bullet":
			return {
				...base,
				kind: "bullet",
				ownerId: entity.ownerId,
				sourceSeq: entity.sourceSeq,
				ttl: entity.ttl,
				damage: entity.damage,
			};
		case "asteroid":
			return {
				...base,
				kind: "asteroid",
				hp: entity.hp,
				spin: entity.spin,
				shape: entity.shape,
			};
		case "pickup":
			return {
				...base,
				kind: "pickup",
				effect: entity.effect,
				ttl: entity.ttl,
			};
		case "explosion":
			return {
				...base,
				kind: "explosion",
				color: entity.color,
				life: entity.life,
				particles: entity.particles.map((particle) => ({
					x: particle.pos.x,
					y: particle.pos.y,
					vx: particle.vel.x,
					vy: particle.vel.y,
					ttl: particle.ttl,
				})),
			};
		default:
			return assertNever(entity);
	}
}

export function entityFromSnapshot(
	data: EntityData,
	arena: Arena,
): AnyEntity | null {
	switch (data.kind) {
		case "ship":
			return attach(
				new Ship({
					id: asEntityId(data.id),
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
		case "bullet":
			return attach(
				new Bullet({
					id: asEntityId(data.id),
					pos: new Vector2(data.x, data.y),
					vel: new Vector2(data.vx, data.vy),
					ownerId: data.ownerId,
					sourceSeq: data.sourceSeq === null ? null : asSeq(data.sourceSeq),
					ttl: data.ttl,
					damage: data.damage,
				}),
				data,
				arena,
			);
		case "asteroid":
			return attach(
				new Asteroid({
					id: asEntityId(data.id),
					pos: new Vector2(data.x, data.y),
					vel: new Vector2(data.vx, data.vy),
					radius: data.radius,
					spin: data.spin,
					shape: [...data.shape],
					hp: data.hp,
				}),
				data,
				arena,
			);
		case "pickup":
			return attach(
				new Pickup({
					id: asEntityId(data.id),
					pos: new Vector2(data.x, data.y),
					effect: data.effect,
					ttl: data.ttl,
				}),
				data,
				arena,
			);
		case "explosion":
			return attach(
				new Explosion({
					id: asEntityId(data.id),
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
		default:
			return assertNever(data);
	}
}

export function serializeEvent(event: GameEvent): GameEvent {
	switch (event.type) {
		case "fired":
			return { ...event, pos: point(event.pos) };
		case "hit":
			return { ...event, pos: point(event.pos) };
		case "exploded":
			return { ...event, pos: point(event.pos) };
		case "shipDestroyed":
			return {
				...event,
				ship: {
					id: event.ship.id,
					playerId: event.ship.playerId,
					color: event.ship.color,
				},
			};
		case "asteroidDestroyed":
			return { ...event };
		case "pickup":
			return { ...event, pos: point(event.pos) };
		case "scoreChanged":
			return { ...event };
		default:
			return assertNever(event);
	}
}
