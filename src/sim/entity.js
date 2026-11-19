import { lerp, lerpAngle } from "../math.js";
import { ARENA, wrapPosition } from "./arena.js";
import { Vector2 } from "./vector.js";

export class Entity {
	static #nextId = 1;
	#id = Entity.#nextId++;

	constructor({
		kind,
		pos = new Vector2(),
		vel = new Vector2(),
		angle = 0,
		radius = 10,
		solid = true,
	}) {
		this.kind = kind;
		this.pos = pos;
		this.prevPos = pos;
		this.vel = vel;
		this.angle = angle;
		this.prevAngle = angle;
		this.radius = radius;
		this.solid = solid;
		this.alive = true;
		this.age = 0;
		this.world = null;
		// composition: small independent behaviours attached at runtime
		this.behaviors = [];
	}

	get id() {
		return this.#id;
	}

	// called by World at the start of every step, before input and update
	savePrevious() {
		this.prevPos = this.pos;
		this.prevAngle = this.angle;
	}

	update(dt) {
		this.runBehaviors(dt);
		this.pos = this.pos.add(this.vel.scale(dt));
		this.handleEdges();
		this.age += dt;
	}

	handleEdges() {
		this.pos = wrapPosition(this.pos);
	}

	kill() {
		this.alive = false;
	}

	addBehavior(behavior) {
		const index = this.behaviors.findIndex((b) => b.name === behavior.name);
		if (index >= 0) this.behaviors[index] = behavior;
		else this.behaviors.push(behavior);
		return this;
	}

	hasBehavior(name) {
		return this.behaviors.some((b) => b.name === name);
	}

	runBehaviors(dt) {
		for (let i = this.behaviors.length - 1; i >= 0; i--) {
			const behavior = this.behaviors[i];
			behavior.update(this, dt);
			if (behavior.done) this.behaviors.splice(i, 1);
		}
	}

	// interpolated position for rendering (alpha in [0, 1))
	renderPos(alpha) {
		const jumped =
			Math.abs(this.pos.x - this.prevPos.x) > ARENA.width / 2 ||
			Math.abs(this.pos.y - this.prevPos.y) > ARENA.height / 2;
		// teleported across the arena edge: do not blend across the screen
		if (jumped) return this.pos;
		return new Vector2(
			lerp(this.prevPos.x, this.pos.x, alpha),
			lerp(this.prevPos.y, this.pos.y, alpha),
		);
	}

	renderAngle(alpha) {
		return lerpAngle(this.prevAngle, this.angle, alpha);
	}
}
