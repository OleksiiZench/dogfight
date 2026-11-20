import { Vector2 } from "./vector.ts";

export class ObjectPool<T> {
	#available: T[] = [];
	#factory: () => T;

	constructor(factory: () => T, prefill = 0) {
		this.#factory = factory;
		for (let index = 0; index < prefill; index++)
			this.#available.push(factory());
	}

	acquire(): T {
		return this.#available.pop() ?? this.#factory();
	}

	release(item: T): void {
		this.#available.push(item);
	}

	clear(): void {
		this.#available.length = 0;
	}

	get size(): number {
		return this.#available.length;
	}
}

export const particlePool = new ObjectPool(() => ({
	pos: new Vector2(),
	vel: new Vector2(),
	ttl: 0,
}));
