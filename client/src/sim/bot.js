import { normalizeAngle } from "../math.js";

const IDLE = Object.freeze({ turn: 0, thrust: false, fire: false });

// Returns a controller closure: calling it gives the bot's intent for this step.
export function createBot(game, playerId) {
	return () => {
		const me = game.players.get(playerId)?.ship;
		if (!me?.alive) return IDLE;

		let target = null;
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
