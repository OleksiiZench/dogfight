import type { Arena, EntityId, Rng } from "../types.ts";
import { ARENA } from "./arena.ts";
import { Entity } from "./entity.ts";
import { Vector2 } from "./vector.ts";

export class Asteroid extends Entity<"asteroid"> {
	#hp: number;

	readonly spin: number;
	readonly shape: number[];

	constructor({
		id = null,
		pos,
		vel,
		radius,
		spin,
		shape,
		hp = null,
	}: {
		id?: EntityId | null;
		pos: Vector2;
		vel: Vector2;
		radius: number;
		spin: number;
		shape: number[];
		hp?: number | null;
	}) {
		super({ id, kind: "asteroid", pos, vel, radius });
		this.spin = spin;
		this.shape = shape;
		this.#hp = hp ?? radius * 1.5;
	}

	static random(rng: Rng, pos: Vector2, id: EntityId | null = null): Asteroid {
		const shape = Array.from({ length: 10 }, () => rng.range(0.75, 1.1));
		return new Asteroid({
			id,
			pos,
			vel: Vector2.fromAngle(rng.range(0, Math.PI * 2), rng.range(30, 90)),
			radius: rng.pick([24, 32, 44]) ?? 24,
			spin: rng.range(-1, 1),
			shape,
		});
	}

	get hp(): number {
		return this.#hp;
	}

	// returns true if this hit destroyed the asteroid
	damage(amount: number): boolean {
		this.#hp -= amount;
		if (this.#hp > 0) return false;
		this.kill();
		return true;
	}

	override update(dt: number): void {
		super.update(dt);
		this.angle += this.spin * dt;
	}

	// asteroids bounce off the arena edges instead of wrapping
	override handleEdges(): void {
		const arena: Arena = this.world?.arena ?? ARENA;
		const r = this.radius;
		let { x, y } = this.pos;
		let { x: vx, y: vy } = this.vel;
		let bounced = false;

		if (x < r) {
			x = r;
			vx = Math.abs(vx);
			bounced = true;
		} else if (x > arena.width - r) {
			x = arena.width - r;
			vx = -Math.abs(vx);
			bounced = true;
		}
		if (y < r) {
			y = r;
			vy = Math.abs(vy);
			bounced = true;
		} else if (y > arena.height - r) {
			y = arena.height - r;
			vy = -Math.abs(vy);
			bounced = true;
		}

		if (bounced) {
			this.pos = new Vector2(x, y);
			this.vel = new Vector2(vx, vy);
		}
	}
}
