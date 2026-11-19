import { Entity } from "./entity.js";

export const BULLET_SPEED = 700;

export class Bullet extends Entity {
	constructor({
		id = null,
		pos,
		vel,
		ownerId,
		sourceSeq = null,
		ttl = 1.5,
		damage = 20,
	}) {
		super({ id, kind: "bullet", pos, vel, radius: 4 });
		this.ownerId = ownerId;
		this.sourceSeq = sourceSeq;
		this.ttl = ttl;
		this.damage = damage;
	}

	update(dt) {
		super.update(dt);
		this.ttl -= dt;
		if (this.ttl <= 0) this.kill();
	}
}
