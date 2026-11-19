import { Entity } from "./entity.js";

// Stationary and collidable, but not a ship. What it DOES is not a subclass:
// it is the name of an effect looked up in EFFECTS (see behaviors.js).
export class Pickup extends Entity {
	constructor({ pos, effect, ttl = 15 }) {
		super({ kind: "pickup", pos, radius: 16 });
		this.effect = effect;
		this.ttl = ttl;
	}

	update(dt) {
		super.update(dt);
		this.ttl -= dt;
		if (this.ttl <= 0) this.kill();
	}
}
