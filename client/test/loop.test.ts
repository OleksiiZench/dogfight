import { afterEach, describe, expect, test, vi } from "vitest";
import { createLoop } from "../src/loop.ts";

afterEach(() => {
	vi.useRealTimers();
	vi.unstubAllGlobals();
});

describe("fixed-step loop", () => {
	test("accumulates elapsed time into fixed steps", () => {
		vi.useFakeTimers();
		vi.stubGlobal("requestAnimationFrame", vi.fn());
		vi.stubGlobal("cancelAnimationFrame", vi.fn());
		const steps: number[] = [];
		const render = vi.fn();
		const loop = createLoop({
			step: 1 / 60,
			scheduler: "interval",
			simulate: (dt) => steps.push(dt),
			render,
		});
		loop.start();
		vi.advanceTimersByTime(80);
		loop.stop();
		expect(steps.length).toBeGreaterThan(0);
		expect(steps.every((dt) => Math.abs(dt - 1 / 60) < 1e-9)).toBe(true);
		expect(render).toHaveBeenCalled();
	});

	test("exposes stats after a window", () => {
		vi.useFakeTimers();
		vi.stubGlobal("requestAnimationFrame", vi.fn());
		vi.stubGlobal("cancelAnimationFrame", vi.fn());
		const loop = createLoop({
			scheduler: "interval",
			simulate: () => {},
			render: () => {},
		});
		loop.start();
		vi.advanceTimersByTime(1100);
		loop.stop();
		expect(loop.stats.framesPerSecond).toBeGreaterThan(0);
		expect(loop.stats.stepsPerSecond).toBeGreaterThan(0);
		expect(loop.stats.frameTimes.length).toBeGreaterThan(1);
		expect(loop.stats.workTimes.length).toBe(loop.stats.frameTimes.length);
	});

	test("clamps long hitches to 250 ms", () => {
		vi.useFakeTimers();
		vi.stubGlobal("requestAnimationFrame", vi.fn());
		vi.stubGlobal("cancelAnimationFrame", vi.fn());
		let frames = 0;
		const loop = createLoop({
			scheduler: "interval",
			simulate: () => {},
			render: () => {
				frames += 1;
			},
		});
		loop.start();
		vi.advanceTimersByTime(1000);
		loop.stop();
		expect(loop.stats.frameTime).toBeLessThanOrEqual(16.001);
		expect(frames).toBeGreaterThan(0);
	});

	test("variable timestep passes raw delta", () => {
		vi.useFakeTimers();
		vi.stubGlobal("requestAnimationFrame", vi.fn());
		vi.stubGlobal("cancelAnimationFrame", vi.fn());
		const deltas: number[] = [];
		const loop = createLoop({
			scheduler: "interval",
			fixed: false,
			simulate: (dt) => deltas.push(dt),
			render: () => {},
		});
		loop.start();
		vi.advanceTimersByTime(80);
		loop.stop();
		expect(deltas.length).toBeGreaterThan(0);
		expect(deltas.every((dt) => dt > 0 && dt <= 0.25)).toBe(true);
	});
});
