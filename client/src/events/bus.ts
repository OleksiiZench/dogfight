import type { GameEvent } from "shared/types.ts";

export type GameEvents = {
	fired: Extract<GameEvent, { type: "fired" }>;
	hit: Extract<GameEvent, { type: "hit" }>;
	exploded: Extract<GameEvent, { type: "exploded" }>;
	shipDestroyed: Extract<GameEvent, { type: "shipDestroyed" }>;
	asteroidDestroyed: Extract<GameEvent, { type: "asteroidDestroyed" }>;
	pickup: Extract<GameEvent, { type: "pickup" }>;
	scoreChanged: Extract<GameEvent, { type: "scoreChanged" }>;
};

export class Bus<Events extends Record<string, unknown>> extends EventTarget {
	on<K extends keyof Events & string>(
		type: K,
		listener: (detail: Events[K]) => void,
	): () => void {
		const handler = (event: Event) => listener(detailOf<Events[K]>(event));
		this.addEventListener(type, handler);
		return () => this.removeEventListener(type, handler);
	}

	emit<K extends keyof Events & string>(type: K, detail: Events[K]): void {
		this.dispatchEvent(new CustomEvent(type, { detail }));
	}
}

export function createBus(): Bus<GameEvents> {
	return new Bus<GameEvents>();
}

export function dispatch(
	bus: EventTarget | null | undefined,
	type: string,
	detail: unknown = undefined,
): void {
	bus?.dispatchEvent(new CustomEvent(type, { detail }));
}

export function detailOf<T>(event: Event): T {
	// Localized assertion: dispatch() always emits CustomEvent with our detail.
	return (event as CustomEvent<T>).detail;
}
