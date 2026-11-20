import { normalizeAngle } from "shared/math.ts";
import type { Ship } from "shared/sim/ship.ts";
import type { Intent, PlayerId } from "shared/types.ts";

const IDLE: Readonly<Intent> = Object.freeze({
	turn: 0,
	thrust: false,
	fire: false,
});

// Returns a controller closure: calling it gives the bot's intent for this step.
export function createBot(
	game: {
		world: { ofKind(kind: "ship"): Iterable<Ship> };
		players: ReadonlyMap<PlayerId, { ship: Ship | null }>;
	},
	playerId: PlayerId,
): () => Intent {
	return () => {
		const me = game.players.get(playerId)?.ship;
		if (!me?.alive) return IDLE;

		let target: Ship | null = null;
		let best = Number.POSITIVE_INFINITY;
		for (const ship of game.world.ofKind("ship")) {
			if (!ship.alive || ship.playerId === playerId) continue;
			const distance = ship.pos.distanceTo(me.pos);
			if (distance < best) {
				best = distance;
				target = ship;
			}
		}
		if (!target) return IDLE;

		const to = target.pos.sub(me.pos);
		const diff = normalizeAngle(Math.atan2(to.y, to.x) - me.angle);
		const aligned = Math.abs(diff);

		return {
			turn: aligned < 0.05 ? 0 : Math.sign(diff),
			thrust: aligned < 0.5 && best > 250,
			fire: aligned < 0.1 && best < 600,
		};
	};
}
