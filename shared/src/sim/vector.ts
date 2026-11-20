import type { Point } from "../types.ts";

// Immutable-style 2D vector: every method returns a NEW Vector2.
export class Vector2 implements Point {
	x: number;
	y: number;

	constructor(x = 0, y = 0) {
		this.x = x;
		this.y = y;
	}

	set(x: number, y: number): this {
		this.x = x;
		this.y = y;
		return this;
	}

	addInPlace(v: Point): this {
		this.x += v.x;
		this.y += v.y;
		return this;
	}

	scaleInPlace(k: number): this {
		this.x *= k;
		this.y *= k;
		return this;
	}

	static fromAngle(angle: number, length = 1): Vector2 {
		return new Vector2(Math.cos(angle) * length, Math.sin(angle) * length);
	}

	add(v: Point): Vector2 {
		return new Vector2(this.x + v.x, this.y + v.y);
	}

	sub(v: Point): Vector2 {
		return new Vector2(this.x - v.x, this.y - v.y);
	}

	scale(k: number): Vector2 {
		return new Vector2(this.x * k, this.y * k);
	}

	length(): number {
		return Math.hypot(this.x, this.y);
	}

	distanceTo(v: Point): number {
		return this.sub(v).length();
	}

	normalize(): Vector2 {
		const len = this.length();
		return len === 0 ? new Vector2() : this.scale(1 / len);
	}

	rotate(angle: number): Vector2 {
		const cos = Math.cos(angle);
		const sin = Math.sin(angle);
		return new Vector2(
			this.x * cos - this.y * sin,
			this.x * sin + this.y * cos,
		);
	}

	dot(v: Point): number {
		return this.x * v.x + this.y * v.y;
	}
}
