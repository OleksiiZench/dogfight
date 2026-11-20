import type { GameEvent } from "shared/types.ts";
import { detailOf } from "../events/bus.ts";

export interface Hud {
	scores: Map<string, number>;
}

export function createHud(bus: EventTarget): Hud {
	const scores = new Map<string, number>();

	bus.addEventListener("scoreChanged", (event) => {
		const detail =
			detailOf<Extract<GameEvent, { type: "scoreChanged" }>>(event);
		for (const [id, score] of Object.entries(detail.scores))
			scores.set(id, score);
	});

	return { scores };
}
