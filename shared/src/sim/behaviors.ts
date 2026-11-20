import { normalizeAngle } from "../math.js";
import { Vector2 } from "./vector.js";

// A behaviour is a plain object: { name, done, update(owner, dt) }.
// Any entity can get any behaviour: this is composition instead of subclasses.

export function timedEffect(name, duration) {
	let left = duration;
	return {
		name,
		get done() {
			return left <= 0;
		},
		get remaining() {
			return left;
		},
		update(_owner, dt) {
			left -= dt;
		},
	};
}

// Steers the owner's velocity towards the nearest target. Works for a bullet
// and for an asteroid alike: it only needs `pos`, `vel` and `world`.
export function homing({ canTarget, turnRate = 3, range = 500 }) {
	return {
		name: "homing",
		done: false,
		update(owner, dt) {
			const speed = owner.vel.length();
			if (speed === 0 || !owner.world) return;

			let target = null;
			let best = range;
			for (const other of owner.world) {
				if (other === owner || !other.alive || !canTarget(owner, other))
					continue;
				const distance = other.pos.distanceTo(owner.pos);
				if (distance < best) {
					best = distance;
					target = other;
				}
			}
			if (!target) return;

			const to = target.pos.sub(owner.pos);
			const current = Math.atan2(owner.vel.y, owner.vel.x);
			const diff = normalizeAngle(Math.atan2(to.y, to.x) - current);
			const limit = turnRate * dt;
			const turn = Math.max(-limit, Math.min(limit, diff));
			owner.vel = Vector2.fromAngle(current + turn, speed);
		},
	};
}

// Behaviour-as-data: a pickup only stores an effect NAME, the table below
// says what the effect does to the ship that picks it up.
export const EFFECTS = new Map([
	[
		"shield",
		{
			label: "S",
			color: "#22d3ee",
			apply: (ship) => ship.addBehavior(timedEffect("shield", 5)),
		},
	],
	[
		"rapid",
		{
			label: "R",
			color: "#facc15",
			apply: (ship) => ship.addBehavior(timedEffect("rapid", 6)),
		},
	],
	[
		"homing",
		{
			label: "H",
			color: "#f472b6",
			apply: (ship) => ship.addBehavior(timedEffect("homingShots", 8)),
		},
	],
	[
		"repair",
		{
			label: "+",
			color: "#4ade80",
			apply: (ship) => ship.heal(40),
		},
	],
]);
