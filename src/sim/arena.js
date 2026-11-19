export const ARENA = { width: 1600, height: 900 };

const mod = (value, size) => ((value % size) + size) % size;

export function wrapShip(ship, arena = ARENA) {
	return {
		...ship,
		x: mod(ship.x, arena.width),
		y: mod(ship.y, arena.height),
	};
}
