import type { Arena, EntityData, Point, Snapshot } from "shared/types.ts";

export function wrappedDistance(a: Point, b: Point, arena: Arena): number {
	const dx = Math.abs(a.x - b.x);
	const dy = Math.abs(a.y - b.y);
	return Math.hypot(
		Math.min(dx, arena.width - dx),
		Math.min(dy, arena.height - dy),
	);
}

export function pendingAfterAck<T extends { seq: number }>(
	pending: readonly T[],
	ack: number,
): T[] {
	return pending.filter((record) => record.seq > ack);
}

export interface BulletReconciliation {
	confirmed: Array<{ key: number; data: EntityData }>;
	confirmedToDelete: number[];
	predictedToDelete: number[];
}

export function reconcileBulletKeys(
	snapshot: Snapshot,
	localId: string,
	ack: number,
	predictedKeys: Iterable<number>,
	confirmedKeys: Iterable<number>,
): BulletReconciliation {
	const confirmed: Array<{ key: number; data: EntityData }> = [];
	const seen = new Set<number>();
	const predictedToDelete = new Set<number>();

	for (const data of snapshot.entities ?? []) {
		if (data.kind !== "bullet" || data.ownerId !== localId) continue;
		const key = data.sourceSeq ?? data.id;
		seen.add(key);
		confirmed.push({ key, data });
		if (data.sourceSeq !== null && data.sourceSeq !== undefined)
			predictedToDelete.add(data.sourceSeq);
	}

	for (const key of predictedKeys) if (key <= ack) predictedToDelete.add(key);

	return {
		confirmed,
		confirmedToDelete: [...confirmedKeys].filter((key) => !seen.has(key)),
		predictedToDelete: [...predictedToDelete],
	};
}
