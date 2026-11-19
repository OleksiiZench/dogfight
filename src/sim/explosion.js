import { Entity } from "./entity.js";
import { Vector2 } from "./vector.js";

// One entity that owns many short-lived particles (plain objects).
export class Explosion extends Entity {
	constructor({
		pos,
		rng,
		color = "#fb923c",
		count = 24,
		speed = 220,
		life = 0.8,
	}) {
		super({ kind: "explosion", pos, radius: 0, solid: false });
		this.color = color;
		this.life = life;
		this.particles = Array.from({ length: count }, () => ({
			pos,
			vel: Vector2.fromAngle(
				rng.range(0, Math.PI * 2),
				rng.range(speed * 0.2, speed),
			),
			ttl: rng.range(life * 0.5, life),
		}));
	}

	update(dt) {
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
