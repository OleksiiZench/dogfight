import type { Arena, Point, Rng } from "../types.ts";
import { Vector2 } from "./vector.ts";

export const ARENA: Arena = { width: 1600, height: 900 };

const mod = (value: number, size: number) => ((value % size) + size) % size;

export function wrapPosition(pos: Vector2, arena: Arena = ARENA): Vector2 {
	const inside =
		pos.x >= 0 && pos.x < arena.width && pos.y >= 0 && pos.y < arena.height;
	if (inside) return pos;
	return new Vector2(mod(pos.x, arena.width), mod(pos.y, arena.height));
}

export function wrapPositionInPlace(
	pos: Vector2,
	arena: Arena = ARENA,
): Vector2 {
	const inside =
		pos.x >= 0 && pos.x < arena.width && pos.y >= 0 && pos.y < arena.height;
	if (inside) return pos;
	return pos.set(mod(pos.x, arena.width), mod(pos.y, arena.height));
}

export function randomPoint(
	rng: Rng,
	margin = 60,
	arena: Arena = ARENA,
): Vector2 {
	return new Vector2(
		rng.range(margin, arena.width - margin),
		rng.range(margin, arena.height - margin),
	);
}

export function pointOf(value: Point): Point {
	return { x: value.x, y: value.y };
}
