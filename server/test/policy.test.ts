import { describe, expect, test } from "vitest";
import { createRateLimiter, heartbeat } from "../src/policy.ts";

describe("rate limiter", () => {
	test("initial state is full at the current time", () => {
		expect(createRateLimiter(10).initial(100)).toEqual({
			tokens: 10,
			lastRefill: 100,
		});
	});

	test("allow consumes one token", () => {
		const limiter = createRateLimiter(2);
		const state = limiter.initial(0);
		expect(limiter.allow(state, 0)).toBe(true);
		expect(state.tokens).toBe(1);
	});

	test("allow rejects when empty", () => {
		const limiter = createRateLimiter(1);
		const state = limiter.initial(0);
		expect(limiter.allow(state, 0)).toBe(true);
		expect(limiter.allow(state, 0)).toBe(false);
	});

	test("allow refills based on elapsed time", () => {
		const limiter = createRateLimiter(10);
		const state = limiter.initial(0);
		state.tokens = 0;
		expect(limiter.allow(state, 500)).toBe(true);
		expect(state.tokens).toBe(4);
	});

	test("refill is capped at the configured rate", () => {
		const limiter = createRateLimiter(3);
		const state = limiter.initial(0);
		state.tokens = 1;
		limiter.allow(state, 100000);
		expect(state.tokens).toBeLessThanOrEqual(3);
	});
});

describe("heartbeat", () => {
	test("alive clients get a ping and reset misses", () => {
		expect(heartbeat({ isAlive: true, missedPongs: 1 }, 2)).toEqual({
			action: "ping",
			isAlive: false,
			missedPongs: 0,
		});
	});

	test("missed pong increments the counter", () => {
		expect(heartbeat({ isAlive: false, missedPongs: 0 }, 3)).toEqual({
			action: "ping",
			isAlive: false,
			missedPongs: 1,
		});
	});

	test("reaching the limit terminates the client", () => {
		expect(heartbeat({ isAlive: false, missedPongs: 1 }, 2)).toEqual({
			action: "terminate",
			isAlive: false,
			missedPongs: 2,
		});
	});
});
