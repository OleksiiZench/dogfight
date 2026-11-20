import { ARENA } from "./arena.ts";
import type { AnyEntity } from "./entity.ts";

const CELL_SIZE = 128;

const mod = (value: number, size: number): number =>
	((value % size) + size) % size;

export function findCollisions(
	entities: Iterable<AnyEntity>,
): Array<[AnyEntity, AnyEntity]> {
	const solids: AnyEntity[] = [];
	const order = new Map<AnyEntity, number>();
	for (const entity of entities) {
		if (!entity.alive || !entity.solid) continue;
		order.set(entity, solids.length);
		solids.push(entity);
	}
	if (solids.length === 0) return [];

	const arena = solids[0]?.world?.arena ?? ARENA;
	const columns = Math.max(1, Math.floor(arena.width / CELL_SIZE) + 1);
	const rows = Math.max(1, Math.floor(arena.height / CELL_SIZE) + 1);
	const cellOf = (entity: AnyEntity): [number, number] => [
		mod(Math.floor(entity.pos.x / CELL_SIZE), columns),
		mod(Math.floor(entity.pos.y / CELL_SIZE), rows),
	];
	const cellKey = (x: number, y: number): number => x + y * columns;
	const buckets = new Map<number, AnyEntity[]>();
	for (const entity of solids) {
		const [x, y] = cellOf(entity);
		const key = cellKey(x, y);
		const bucket = buckets.get(key) ?? [];
		bucket.push(entity);
		buckets.set(key, bucket);
	}

	const pairs: Array<[AnyEntity, AnyEntity]> = [];
	for (const entity of solids) {
		const currentOrder = order.get(entity) ?? -1;
		const [cellX, cellY] = cellOf(entity);
		for (let offsetY = -1; offsetY <= 1; offsetY++) {
			const y = mod(cellY + offsetY, rows);
			for (let offsetX = -1; offsetX <= 1; offsetX++) {
				const x = mod(cellX + offsetX, columns);
				const bucket = buckets.get(cellKey(x, y));
				if (!bucket) continue;
				for (const other of bucket) {
					const otherOrder = order.get(other) ?? -1;
					if (otherOrder <= currentOrder) continue;
					const dx = entity.pos.x - other.pos.x;
					const dy = entity.pos.y - other.pos.y;
					const reach = entity.radius + other.radius;
					if (dx * dx + dy * dy < reach * reach) pairs.push([entity, other]);
				}
			}
		}
	}
	return pairs;
}
