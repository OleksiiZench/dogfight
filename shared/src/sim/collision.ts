import type { AnyEntity } from "./entity.ts";

// Collision SYSTEM: takes any iterable of entities and returns pairs that
// overlap. Naive O(n^2) for now; it can be swapped for a spatial hash later
// without touching World or the rules.
export function findCollisions(
	entities: Iterable<AnyEntity>,
): Array<[AnyEntity, AnyEntity]> {
	const solids: AnyEntity[] = [];
	for (const entity of entities) {
		if (entity.alive && entity.solid) solids.push(entity);
	}

	const pairs: Array<[AnyEntity, AnyEntity]> = [];
	for (let i = 0; i < solids.length; i++) {
		const a = solids[i];
		if (!a) continue;
		for (let j = i + 1; j < solids.length; j++) {
			const b = solids[j];
			if (!b) continue;
			const dx = a.pos.x - b.pos.x;
			const dy = a.pos.y - b.pos.y;
			const reach = a.radius + b.radius;
			if (dx * dx + dy * dy < reach * reach) pairs.push([a, b]);
		}
	}
	return pairs;
}
