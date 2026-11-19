import { ARENA } from "./arena.js";
import { Entity } from "./entity.js";
import { Vector2 } from "./vector.js";

export class Asteroid extends Entity {
	#hp;

	constructor({ pos, vel, radius, spin, shape }) {
		super({ kind: "asteroid", pos, vel, radius });
		this.spin = spin;
		this.shape = shape;
		this.#hp = radius * 1.5;
	}

	static random(rng, pos) {
		const shape = Array.from({ length: 10 }, () => rng.range(0.75, 1.1));
		return new Asteroid({
			pos,
			vel: Vector2.fromAngle(rng.range(0, Math.PI * 2), rng.range(30, 90)),
			radius: rng.pick([24, 32, 44]),
			spin: rng.range(-1, 1),
			shape,
		});
	}

	get hp() {
		return this.#hp;
	}

	// returns true if this hit destroyed the asteroid
	damage(amount) {
		this.#hp -= amount;
		if (this.#hp > 0) return false;
		this.kill();
		return true;
	}

	update(dt) {
		super.update(dt);
		this.angle += this.spin * dt;
	}

	// asteroids bounce off the arena edges instead of wrapping
	handleEdges() {
		const r = this.radius;
		let { x, y } = this.pos;
		let { x: vx, y: vy } = this.vel;
		let bounced = false;

		if (x < r) {
			x = r;
			vx = Math.abs(vx);
			bounced = true;
		} else if (x > ARENA.width - r) {
			x = ARENA.width - r;
			vx = -Math.abs(vx);
			bounced = true;
		}
		if (y < r) {
			y = r;
			vy = Math.abs(vy);
			bounced = true;
		} else if (y > ARENA.height - r) {
			y = ARENA.height - r;
			vy = -Math.abs(vy);
			bounced = true;
		}

		if (bounced) {
			this.pos = new Vector2(x, y);
			this.vel = new Vector2(vx, vy);
		}
	}
}
