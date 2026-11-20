import { lerp, lerpAngle } from "../math.ts";
import type { Arena, EntityId, EntityKind, PlayerId } from "../types.ts";
import { asEntityId } from "../types.ts";
import { ARENA, wrapPosition } from "./arena.ts";
import type { Asteroid } from "./asteroid.ts";
import type { Behavior } from "./behaviors.ts";
import type { Bullet } from "./bullet.ts";
import type { Explosion } from "./explosion.ts";
import type { Pickup } from "./pickup.ts";
import type { Ship } from "./ship.ts";
import { Vector2 } from "./vector.ts";
import type { WorldLike } from "./world.ts";

export type AnyEntity = Ship | Bullet | Asteroid | Pickup | Explosion;

export interface BehaviorOwner {
	kind: EntityKind;
	pos: Vector2;
	vel: Vector2;
	alive: boolean;
	world: WorldLike | null;
	ownerId?: PlayerId;
}

export interface EntityInit<K extends EntityKind> {
	id?: EntityId | null;
	kind: K;
	pos?: Vector2;
	vel?: Vector2;
	angle?: number;
	radius?: number;
	solid?: boolean;
}

export class Entity<K extends EntityKind = EntityKind> {
	static #nextId = 1;
	#id: EntityId;

	readonly kind: K;
	pos: Vector2;
	prevPos: Vector2;
	vel: Vector2;
	angle: number;
	prevAngle: number;
	radius: number;
	solid: boolean;
	alive: boolean;
	age: number;
	world: WorldLike | null;
	behaviors: Behavior[];

	constructor({
		id = null,
		kind,
		pos = new Vector2(),
		vel = new Vector2(),
		angle = 0,
		radius = 10,
		solid = true,
	}: EntityInit<K>) {
		this.#id = id ?? asEntityId(Entity.#nextId++);
		this.kind = kind;
		this.pos = pos;
		this.prevPos = pos;
		this.vel = vel;
		this.angle = angle;
		this.prevAngle = angle;
		this.radius = radius;
		this.solid = solid;
		this.alive = true;
		this.age = 0;
		this.world = null;
		// composition: small independent behaviours attached at runtime
		this.behaviors = [];
	}

	get id(): EntityId {
		return this.#id;
	}

	// called by World at the start of every step, before input and update
	savePrevious(): void {
		this.prevPos = this.pos;
		this.prevAngle = this.angle;
	}

	update(dt: number): void {
		this.runBehaviors(dt);
		this.pos = this.pos.add(this.vel.scale(dt));
		this.handleEdges();
		this.age += dt;
	}

	handleEdges(): void {
		const arena: Arena = this.world?.arena ?? ARENA;
		this.pos = wrapPosition(this.pos, arena);
	}

	kill(): void {
		this.alive = false;
	}

	addBehavior(behavior: Behavior): this {
		const index = this.behaviors.findIndex((b) => b.name === behavior.name);
		if (index >= 0) this.behaviors[index] = behavior;
		else this.behaviors.push(behavior);
		return this;
	}

	hasBehavior(name: string): boolean {
		return this.behaviors.some((b) => b.name === name);
	}

	runBehaviors(dt: number): void {
		for (let i = this.behaviors.length - 1; i >= 0; i--) {
			const behavior = this.behaviors[i];
			if (!behavior) continue;
			behavior.update(this, dt);
			if (behavior.done) this.behaviors.splice(i, 1);
		}
	}

	// interpolated position for rendering (alpha in [0, 1))
	renderPos(alpha: number): Vector2 {
		const arena: Arena = this.world?.arena ?? ARENA;
		const jumped =
			Math.abs(this.pos.x - this.prevPos.x) > arena.width / 2 ||
			Math.abs(this.pos.y - this.prevPos.y) > arena.height / 2;
		// teleported across the arena edge: do not blend across the screen
		if (jumped) return this.pos;
		return new Vector2(
			lerp(this.prevPos.x, this.pos.x, alpha),
			lerp(this.prevPos.y, this.pos.y, alpha),
		);
	}

	renderAngle(alpha: number): number {
		return lerpAngle(this.prevAngle, this.angle, alpha);
	}
}
