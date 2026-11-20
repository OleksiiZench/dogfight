import type { EntityId, PlayerId, Seq } from "../types.ts";
import { Entity } from "./entity.ts";
import type { Vector2 } from "./vector.ts";

export const BULLET_SPEED = 700;

export class Bullet extends Entity<"bullet"> {
	readonly ownerId: PlayerId;
	readonly sourceSeq: Seq | null;
	ttl: number;
	readonly damage: number;

	constructor({
		id = null,
		pos,
		vel,
		ownerId,
		sourceSeq = null,
		ttl = 1.5,
		damage = 20,
	}: {
		id?: EntityId | null;
		pos: Vector2;
		vel: Vector2;
		ownerId: PlayerId;
		sourceSeq?: Seq | null;
		ttl?: number;
		damage?: number;
	}) {
		super({ id, kind: "bullet", pos, vel, radius: 4 });
		this.ownerId = ownerId;
		this.sourceSeq = sourceSeq;
		this.ttl = ttl;
		this.damage = damage;
	}

	override update(dt: number): void {
		super.update(dt);
		this.ttl -= dt;
		if (this.ttl <= 0) this.kill();
	}
}
