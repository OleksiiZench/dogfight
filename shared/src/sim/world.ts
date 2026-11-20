import type {
	Arena,
	EntityId,
	EntityKind,
	GameEvent,
	Intent,
	Rng,
} from "../types.ts";
import { asEntityId } from "../types.ts";
import { ARENA } from "./arena.ts";
import type { Asteroid } from "./asteroid.ts";
import type { Bullet } from "./bullet.ts";
import { findCollisions } from "./collision.ts";
import type { AnyEntity } from "./entity.ts";
import type { Explosion } from "./explosion.ts";
import type { Pickup } from "./pickup.ts";
import { resolveCollision } from "./rules.ts";
import type { Ship } from "./ship.ts";

export interface WorldLike {
	readonly arena: Arena;
	readonly rng: Rng;
	nextId(): EntityId;
	spawn(entity: AnyEntity): AnyEntity;
	emit(event: GameEvent): void;
	[Symbol.iterator](): IterableIterator<AnyEntity>;
	ofKind(kind: "ship"): Generator<Ship>;
	ofKind(kind: "bullet"): Generator<Bullet>;
	ofKind(kind: "asteroid"): Generator<Asteroid>;
	ofKind(kind: "pickup"): Generator<Pickup>;
	ofKind(kind: "explosion"): Generator<Explosion>;
	ofKind(kind: EntityKind): Generator<AnyEntity>;
}

export class World implements WorldLike {
	#entities = new Map<EntityId, AnyEntity>(); // id -> Entity
	#snapshot: AnyEntity[] = []; // reused buffer: entities spawned mid-step wait for next step
	#events: GameEvent[] = [];
	#nextId: EntityId;

	readonly rng: Rng;
	readonly arena: Arena;

	constructor({
		rng,
		arena = ARENA,
		idStart = 1,
	}: {
		rng: Rng;
		arena?: Arena;
		idStart?: number;
	}) {
		this.rng = rng;
		this.arena = arena;
		this.#nextId = asEntityId(idStart);
	}

	nextId(): EntityId {
		const id = this.#nextId;
		this.#nextId = asEntityId(id + 1);
		return id;
	}

	get size(): number {
		return this.#entities.size;
	}

	spawn<T extends AnyEntity>(entity: T): T {
		entity.world = this;
		this.#entities.set(entity.id, entity);
		return entity;
	}

	// deferred: only marks the entity dead, the sweep at the end of step removes it
	despawn(id: EntityId): void {
		this.#entities.get(id)?.kill();
	}

	get(id: EntityId): AnyEntity | undefined {
		return this.#entities.get(id);
	}

	*[Symbol.iterator](): IterableIterator<AnyEntity> {
		yield* this.#entities.values();
	}

	ofKind(kind: "ship"): Generator<Ship>;
	ofKind(kind: "bullet"): Generator<Bullet>;
	ofKind(kind: "asteroid"): Generator<Asteroid>;
	ofKind(kind: "pickup"): Generator<Pickup>;
	ofKind(kind: "explosion"): Generator<Explosion>;
	ofKind(kind: EntityKind): Generator<AnyEntity>;
	*ofKind(kind: EntityKind): Generator<AnyEntity> {
		for (const entity of this) {
			if (entity.kind === kind) yield entity;
		}
	}

	emit(event: GameEvent): void {
		this.#events.push(event);
	}

	drainEvents(): GameEvent[] {
		const events = this.#events;
		this.#events = [];
		return events;
	}

	// intents: Map<entityId, { turn, thrust, fire }>
	step(dt: number, intents: ReadonlyMap<EntityId, Intent> = new Map()): void {
		const snapshot = this.#snapshot;
		snapshot.length = 0;
		for (const entity of this.#entities.values()) snapshot.push(entity);

		for (const entity of snapshot) entity.savePrevious();

		for (const entity of snapshot) {
			const intent = intents.get(entity.id);
			if (intent && entity.alive && entity.kind === "ship")
				entity.control(intent, dt);
		}

		for (const entity of snapshot) {
			if (entity.alive) entity.update(dt);
		}

		for (const [a, b] of findCollisions(this)) resolveCollision(a, b, this);

		this.#sweep();
	}

	#sweep(): void {
		for (const [id, entity] of this.#entities) {
			if (entity.alive) continue;
			this.#entities.delete(id);
			entity.world = null;
		}
	}
}

export function createStaticWorld(arena: Arena): WorldLike {
	const entities: AnyEntity[] = [];
	const rng: Rng = {
		next: () => 0,
		range: (min) => min,
		pick: (items) => items[0],
	};

	function ofKind(kind: "ship"): Generator<Ship>;
	function ofKind(kind: "bullet"): Generator<Bullet>;
	function ofKind(kind: "asteroid"): Generator<Asteroid>;
	function ofKind(kind: "pickup"): Generator<Pickup>;
	function ofKind(kind: "explosion"): Generator<Explosion>;
	function ofKind(kind: EntityKind): Generator<AnyEntity>;
	function* ofKind(kind: EntityKind): Generator<AnyEntity> {
		for (const entity of entities) {
			if (entity.kind === kind) yield entity;
		}
	}

	return {
		arena,
		rng,
		nextId: () => asEntityId(0),
		spawn(entity) {
			entities.push(entity);
			return entity;
		},
		emit(_event) {},
		*[Symbol.iterator]() {
			yield* entities;
		},
		ofKind,
	};
}
