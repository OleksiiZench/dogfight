import { Vector2 } from "./vector.js";

export const ARENA = { width: 1600, height: 900 };

const mod = (value, size) => ((value % size) + size) % size;

export function wrapPosition(pos, arena = ARENA) {
	const inside =
		pos.x >= 0 && pos.x < arena.width && pos.y >= 0 && pos.y < arena.height;
	if (inside) return pos;
	return new Vector2(mod(pos.x, arena.width), mod(pos.y, arena.height));
}

export function randomPoint(rng, margin = 60, arena = ARENA) {
	return new Vector2(
		rng.range(margin, arena.width - margin),
		rng.range(margin, arena.height - margin),
	);
}
