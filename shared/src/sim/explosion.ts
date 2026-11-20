import type { EntityId, Rng } from "../types.ts";
import { Entity } from "./entity.ts";
import { particlePool } from "./pool.ts";
import type { Vector2 } from "./vector.ts";

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
	#pooled: boolean;

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
		this.#pooled = particles === null;
		this.particles =
			particles ??
			Array.from({ length: count }, () => {
				const particle = particlePool.acquire();
				const angle = rng?.range(0, Math.PI * 2) ?? 0;
				const velocity = rng?.range(speed * 0.2, speed) ?? 0;
				particle.pos.set(pos.x, pos.y);
				particle.vel.set(
					Math.cos(angle) * velocity,
					Math.sin(angle) * velocity,
				);
				particle.ttl = rng?.range(life * 0.5, life) ?? 0;
				return particle;
			});
	}

	override kill(): void {
		if (!this.alive || !this.#pooled) {
			super.kill();
			return;
		}
		super.kill();
		for (const particle of this.particles) particlePool.release(particle);
	}

	override update(dt: number): void {
		this.age += dt;
		const damping = Math.exp(-2 * dt);
		let anyAlive = false;
		for (const p of this.particles) {
			if (p.ttl <= 0) continue;
			p.ttl -= dt;
			p.pos.x += p.vel.x * dt;
			p.pos.y += p.vel.y * dt;
			p.vel.scaleInPlace(damping);
			anyAlive = true;
		}
		if (!anyAlive) this.kill();
	}
}
