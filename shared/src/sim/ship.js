import { normalizeAngle } from "../math.js";
import { homing } from "./behaviors.js";
import { BULLET_SPEED, Bullet } from "./bullet.js";
import { Entity } from "./entity.js";
import { Vector2 } from "./vector.js";

export const TURN_RATE = 3.5; // rad/s
export const THRUST = 700; // px/s^2
export const DRAG = 1.5; // 1/s
export const MAX_SPEED = 450; // px/s

export class Ship extends Entity {
	#hp;

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

	get hp() {
		return this.#hp;
	}

	get invulnerable() {
		return this.hasBehavior("shield") || this.hasBehavior("invuln");
	}

	// returns true if this hit destroyed the ship
	damage(amount) {
		if (!this.alive || this.invulnerable) return false;
		this.#hp = Math.max(0, this.#hp - amount);
		if (this.#hp === 0) {
			this.kill();
			return true;
		}
		return false;
	}

	heal(amount) {
		this.#hp = Math.min(this.maxHp, this.#hp + amount);
	}

	// intent = { turn: -1..1, thrust: bool, fire: bool } (from keyboard or bot)
	control(intent, dt) {
		this.angle = normalizeAngle(this.angle + intent.turn * TURN_RATE * dt);
		this.thrusting = Boolean(intent.thrust);
		if (this.thrusting) {
			this.vel = this.vel.add(Vector2.fromAngle(this.angle, THRUST * dt));
		}
		if (intent.fire) this.fire(intent.seq);
	}

	update(dt) {
		this.vel = this.vel.scale(Math.exp(-DRAG * dt));
		const speed = this.vel.length();
		if (speed > MAX_SPEED) this.vel = this.vel.scale(MAX_SPEED / speed);
		super.update(dt);
		this.cooldown = Math.max(0, this.cooldown - dt);
	}

	fire(sourceSeq = null) {
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
