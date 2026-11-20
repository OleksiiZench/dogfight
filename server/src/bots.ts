import { normalizeAngle } from "shared/math.ts";
import type { Game } from "shared/sim/game.ts";
import type { Intent, PlayerId } from "shared/types.ts";

const MAX_TURN = 0.8;
const AVOID_RANGE = 130;

function clamp(value: number, min: number, max: number): number {
	return Math.min(max, Math.max(min, value));
}

function steerTowards(angle: number, desired: number): number {
	return clamp(normalizeAngle(desired - angle) / MAX_TURN, -1, 1);
}

export class Bot {
	readonly id: PlayerId;
	readonly name: string;
	readonly color: string;
	readonly fireDelay: number;
	#intent: Intent;

	constructor(index: number) {
		this.id = `bot-${index}`;
		this.name = `Bot ${index}`;
		this.color =
			["#f87171", "#facc15", "#c084fc", "#2dd4bf"][index % 4] ?? "#f87171";
		this.fireDelay = 0.16;
		this.#intent = { turn: 0, thrust: false, fire: false };
	}

	update(game: Game, tick: number): Intent {
		const intent = this.#intent;
		intent.turn = 0;
		intent.thrust = false;
		intent.fire = false;
		const ship = game.players.get(this.id)?.ship;
		if (!ship?.alive) return intent;

		let targetX = game.arena.width / 2;
		let targetY = game.arena.height / 2;
		let targetDistance = Number.POSITIVE_INFINITY;
		let hasTarget = false;

		for (const player of game.players.values()) {
			if (player.id === this.id || !player.ship?.alive) continue;
			const dx = player.ship.pos.x - ship.pos.x;
			const dy = player.ship.pos.y - ship.pos.y;
			const distance = Math.hypot(dx, dy);
			if (distance < targetDistance) {
				targetDistance = distance;
				targetX = player.ship.pos.x;
				targetY = player.ship.pos.y;
				hasTarget = true;
			}
		}

		let desired = Math.atan2(targetY - ship.pos.y, targetX - ship.pos.x);
		let threatX = 0;
		let threatY = 0;
		let threatDistance = AVOID_RANGE;
		for (const asteroid of game.world.ofKind("asteroid")) {
			const dx = asteroid.pos.x - ship.pos.x;
			const dy = asteroid.pos.y - ship.pos.y;
			const distance = Math.hypot(dx, dy);
			if (distance >= threatDistance || distance === 0) continue;
			threatDistance = distance;
			threatX = dx / distance;
			threatY = dy / distance;
		}
		if (threatDistance < AVOID_RANGE) {
			desired = Math.atan2(-threatY, -threatX);
		}

		intent.turn = steerTowards(ship.angle, desired);
		intent.thrust = Math.abs(intent.turn) < 0.85 || targetDistance > 380;
		if (hasTarget) {
			const aim = Math.abs(normalizeAngle(desired - ship.angle));
			intent.fire = aim < 0.32 && targetDistance < 720;
		} else {
			intent.fire = tick % 7 === this.id.length % 7;
		}
		return intent;
	}
}

export function createBots(count: number): Bot[] {
	return Array.from({ length: count }, (_, index) => new Bot(index + 1));
}
