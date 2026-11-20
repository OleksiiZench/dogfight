import { normalizeAngle } from "../math.ts";
import type { EntityId, Intent, PlayerId, Seq } from "../types.ts";
import { homing } from "./behaviors.ts";
import { BULLET_SPEED, Bullet } from "./bullet.ts";
import { Entity } from "./entity.ts";
import { Vector2 } from "./vector.ts";

export const TURN_RATE = 3.5; // rad/s
export const THRUST = 700; // px/s^2
export const DRAG = 1.5; // 1/s
export const MAX_SPEED = 450; // px/s

export class Ship extends Entity<"ship"> {
	#hp: number;

	readonly playerId: PlayerId;
	readonly color: string;
	readonly maxHp: number;
	readonly fireDelay: number;
	cooldown: number;
	thrusting: boolean;

	constructor({
		id = null,
		playerId,
		pos,
		angle = -Math.PI / 2,
		hp = null,
		color = "#4ade80",
		maxHp = 100,
		fireDelay = 0.25,
		cooldown = 0,
		thrusting = false,
	}: {
		id?: EntityId | null;
		playerId: PlayerId;
		pos?: Vector2;
		angle?: number;
		hp?: number | null;
		color?: string;
		maxHp?: number;
		fireDelay?: number;
		cooldown?: number;
		thrusting?: boolean;
	}) {
		super({ id, kind: "ship", pos, angle, radius: 22 });
		this.playerId = playerId;
		this.color = color;
		this.maxHp = maxHp;
		this.fireDelay = fireDelay;
		this.cooldown = cooldown;
		this.thrusting = thrusting;
		this.#hp = hp ?? maxHp;
	}

	get hp(): number {
		return this.#hp;
	}

	get invulnerable(): boolean {
		return this.hasBehavior("shield") || this.hasBehavior("invuln");
	}

	// returns true if this hit destroyed the ship
	damage(amount: number): boolean {
		if (!this.alive || this.invulnerable) return false;
		this.#hp = Math.max(0, this.#hp - amount);
		if (this.#hp === 0) {
			this.kill();
			return true;
		}
		return false;
	}

	heal(amount: number): void {
		this.#hp = Math.min(this.maxHp, this.#hp + amount);
	}

	// intent = { turn: -1..1, thrust: bool, fire: bool } (from keyboard or bot)
	control(intent: Intent, dt: number): void {
		this.angle = normalizeAngle(this.angle + intent.turn * TURN_RATE * dt);
		this.thrusting = Boolean(intent.thrust);
		if (this.thrusting) {
			this.vel.x += Math.cos(this.angle) * THRUST * dt;
			this.vel.y += Math.sin(this.angle) * THRUST * dt;
		}
		if (intent.fire) this.fire(intent.seq);
	}

	override update(dt: number): void {
		this.vel.scaleInPlace(Math.exp(-DRAG * dt));
		const speed = Math.hypot(this.vel.x, this.vel.y);
		if (speed > MAX_SPEED) this.vel.scaleInPlace(MAX_SPEED / speed);
		super.update(dt);
		this.cooldown = Math.max(0, this.cooldown - dt);
	}

	fire(sourceSeq: Seq | null = null): boolean {
		// `this` is decided by the call site, so fail loudly when it is wrong
		if (!(this instanceof Ship)) {
			throw new TypeError(`Ship.fire() called with wrong this: ${this}`);
		}
		if (!this.alive || !this.world || this.cooldown > 0) return false;

		this.cooldown = this.hasBehavior("rapid")
			? this.fireDelay / 3
			: this.fireDelay;

		const dir = Vector2.fromAngle(this.angle);
		const bullet = new Bullet({
			id: this.world.nextId(),
			pos: this.pos.add(dir.scale(this.radius + 8)),
			vel: this.vel.add(dir.scale(BULLET_SPEED)),
			ownerId: this.playerId,
			sourceSeq,
		});

		if (this.hasBehavior("homingShots")) {
			bullet.addBehavior(
				homing({
					turnRate: 4,
					range: 450,
					canTarget: (self, other) =>
						other.kind === "asteroid" ||
						(other.kind === "ship" && other.playerId !== self.ownerId),
				}),
			);
		}

		this.world.spawn(bullet);
		this.world.emit({
			type: "fired",
			ownerId: this.playerId,
			pos: bullet.pos,
			angle: this.angle,
		});
		return true;
	}
}
