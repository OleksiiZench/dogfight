import { ARENA } from "./arena.js";
import { findCollisions } from "./collision.js";
import { resolveCollision } from "./rules.js";

export class World {
	#entities = new Map(); // id -> Entity
	#snapshot = []; // reused buffer: entities spawned mid-step wait for next step
	#events = [];

	constructor({ rng, arena = ARENA }) {
		this.rng = rng;
		this.arena = arena;
	}

	get size() {
		return this.#entities.size;
	}

	spawn(entity) {
		entity.world = this;
		this.#entities.set(entity.id, entity);
		return entity;
	}

	// deferred: only marks the entity dead, the sweep at the end of step removes it
	despawn(id) {
		this.#entities.get(id)?.kill();
	}

	get(id) {
		return this.#entities.get(id);
	}

	*[Symbol.iterator]() {
		yield* this.#entities.values();
	}

	*ofKind(kind) {
		for (const entity of this) {
			if (entity.kind === kind) yield entity;
		}
	}

	emit(event) {
		this.#events.push(event);
	}

	drainEvents() {
		const events = this.#events;
		this.#events = [];
		return events;
	}

	// intents: Map<entityId, { turn, thrust, fire }>
	step(dt, intents = new Map()) {
		const snapshot = this.#snapshot;
		snapshot.length = 0;
		for (const entity of this.#entities.values()) snapshot.push(entity);

		for (const entity of snapshot) entity.savePrevious();

		for (const entity of snapshot) {
			const intent = intents.get(entity.id);
			if (intent && entity.alive) entity.control?.(intent, dt);
		}

		for (const entity of snapshot) {
			if (entity.alive) entity.update(dt);
		}

		for (const [a, b] of findCollisions(this)) resolveCollision(a, b, this);

		this.#sweep();
	}

	#sweep() {
		for (const [id, entity] of this.#entities) {
			if (entity.alive) continue;
			this.#entities.delete(id);
			entity.world = null;
		}
	}
}
