import { describe, expect, test } from "vitest";
import { Vector2 } from "../src/sim/vector.ts";

describe("Vector2", () => {
	test("defaults to the origin", () => {
		expect(new Vector2()).toMatchObject({ x: 0, y: 0 });
	});

	test("add returns a new vector", () => {
		const a = new Vector2(1, 2);
		const result = a.add({ x: 3, y: 4 });
		expect(result).toMatchObject({ x: 4, y: 6 });
		expect(a).toMatchObject({ x: 1, y: 2 });
		expect(result).not.toBe(a);
	});

	test("sub returns component differences", () => {
		expect(new Vector2(5, 7).sub({ x: 2, y: 3 })).toMatchObject({ x: 3, y: 4 });
	});

	test("scale multiplies both components", () => {
		expect(new Vector2(2, -3).scale(2.5)).toMatchObject({ x: 5, y: -7.5 });
	});

	test("length uses hypot", () => {
		expect(new Vector2(3, 4).length()).toBe(5);
	});

	test("distanceTo measures between points", () => {
		expect(new Vector2(1, 1).distanceTo({ x: 4, y: 5 })).toBe(5);
	});

	test("normalize keeps direction", () => {
		const result = new Vector2(3, 4).normalize();
		expect(result.x).toBeCloseTo(0.6);
		expect(result.y).toBeCloseTo(0.8);
	});

	test("normalize of zero returns zero", () => {
		expect(new Vector2().normalize()).toMatchObject({ x: 0, y: 0 });
	});

	test("rotate preserves length", () => {
		const result = new Vector2(1, 0).rotate(Math.PI / 2);
		expect(result.x).toBeCloseTo(0);
		expect(result.y).toBeCloseTo(1);
		expect(result.length()).toBeCloseTo(1);
	});

	test("dot returns the scalar product", () => {
		expect(new Vector2(2, 3).dot({ x: 4, y: 5 })).toBe(23);
	});

	test("fromAngle respects length", () => {
		const result = Vector2.fromAngle(0, 7);
		expect(result.x).toBeCloseTo(7);
		expect(result.y).toBeCloseTo(0);
	});
});
