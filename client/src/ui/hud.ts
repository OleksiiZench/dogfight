import type { Bus, GameEvents } from "../events/bus.ts";

export interface Hud {
	scores: Map<string, number>;
}

export function createHud(bus: Bus<GameEvents>): Hud {
	const scores = new Map<string, number>();

	bus.on("scoreChanged", (detail) => {
		for (const [id, score] of Object.entries(detail.scores))
			scores.set(id, score);
	});

	return { scores };
}
