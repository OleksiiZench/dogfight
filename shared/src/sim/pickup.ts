import type { EffectName, EntityId } from "../types.ts";
import { Entity } from "./entity.ts";
import type { Vector2 } from "./vector.ts";

// Stationary and collidable, but not a ship. What it DOES is not a subclass:
// it is the name of an effect looked up in EFFECTS (see behaviors.ts).
export class Pickup extends Entity<"pickup"> {
	readonly effect: EffectName;
	ttl: number;

	constructor({
		id = null,
		pos,
		effect,
		ttl = 15,
	}: {
		id?: EntityId | null;
		pos: Vector2;
		effect: EffectName;
		ttl?: number;
	}) {
		super({ id, kind: "pickup", pos, radius: 16 });
		this.effect = effect;
		this.ttl = ttl;
	}

	override update(dt: number): void {
		super.update(dt);
		this.ttl -= dt;
		if (this.ttl <= 0) this.kill();
	}
}
