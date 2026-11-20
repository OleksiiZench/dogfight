import type { EntityId, Rng } from "../types.ts";
import { Entity } from "./entity.ts";
import { Vector2 } from "./vector.ts";

export interface Particle {
	pos: Vector2;
	vel: Vector2;
	ttl: number;
}

// One entity that owns many short-lived particles (plain objects).
export class Explosion extends Entity<"explosion"> {
	readonly color: string;
	readonly life: number;
	readonly particles: Particle[];

	constructor({
		id = null,
		pos,
		rng,
		color = "#fb923c",
		count = 24,
		speed = 220,
		life = 0.8,
		particles = null,
	}: {
		id?: EntityId | null;
		pos: Vector2;
		rng?: Rng;
		color?: string;
		count?: number;
		speed?: number;
		life?: number;
		particles?: Particle[] | null;
	}) {
		super({ id, kind: "explosion", pos, radius: 0, solid: false });
		this.color = color;
		this.life = life;
		this.particles =
			particles ??
			Array.from({ length: count }, () => ({
				pos,
				vel: Vector2.fromAngle(
					rng?.range(0, Math.PI * 2) ?? 0,
					rng?.range(speed * 0.2, speed) ?? 0,
				),
				ttl: rng?.range(life * 0.5, life) ?? 0,
			}));
	}

	override update(dt: number): void {
		this.age += dt;
		const damping = Math.exp(-2 * dt);
		let anyAlive = false;
		for (const p of this.particles) {
			if (p.ttl <= 0) continue;
			p.ttl -= dt;
			p.pos = p.pos.add(p.vel.scale(dt));
			p.vel = p.vel.scale(damping);
			anyAlive = true;
		}
		if (!anyAlive) this.kill();
	}
}
