import { Entity } from "./entity.js";

export const BULLET_SPEED = 700;

export class Bullet extends Entity {
	constructor({ pos, vel, ownerId, ttl = 1.5, damage = 20 }) {
		super({ kind: "bullet", pos, vel, radius: 4 });
		this.ownerId = ownerId;
		this.ttl = ttl;
		this.damage = damage;
	}

	update(dt) {
		super.update(dt);
		this.ttl -= dt;
		if (this.ttl <= 0) this.kill();
	}
}
