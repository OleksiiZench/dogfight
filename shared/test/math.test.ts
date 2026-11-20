import { describe, expect, test } from "vitest";
import {
	clamp,
	createRng,
	lerp,
	lerpAngle,
	normalizeAngle,
} from "../src/math.ts";

describe("math helpers", () => {
	test("lerp interpolates endpoints", () => {
		expect(lerp(10, 20, 0)).toBe(10);
		expect(lerp(10, 20, 0.5)).toBe(15);
		expect(lerp(10, 20, 1)).toBe(20);
	});

	test("clamp constrains to range", () => {
		expect(clamp(5, 0, 10)).toBe(5);
		expect(clamp(-1, 0, 10)).toBe(0);
		expect(clamp(11, 0, 10)).toBe(10);
	});

	test("normalizeAngle wraps positive angles", () => {
		expect(normalizeAngle(Math.PI * 3)).toBeCloseTo(-Math.PI);
	});

	test("normalizeAngle wraps negative angles", () => {
		expect(normalizeAngle(-Math.PI * 3)).toBeCloseTo(-Math.PI);
	});

	test("lerpAngle takes the shortest arc", () => {
		expect(lerpAngle(3, -3, 0.5)).toBeCloseTo(Math.PI);
	});

	test("createRng is deterministic for a seed", () => {
		expect(createRng(42).next()).toBe(createRng(42).next());
	});

	test("createRng range stays inside bounds", () => {
		const rng = createRng(7);
		for (let i = 0; i < 50; i++) {
			const value = rng.range(2, 5);
			expect(value).toBeGreaterThanOrEqual(2);
			expect(value).toBeLessThanOrEqual(5);
		}
	});

	test("createRng pick returns an element", () => {
		expect(createRng(9).pick(["a", "b"])).toBeTypeOf("string");
	});

	test("createRng pick of empty array is undefined", () => {
		expect(createRng(9).pick([])).toBeUndefined();
	});
});
