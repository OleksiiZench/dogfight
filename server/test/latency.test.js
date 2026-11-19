import assert from "node:assert/strict";
import { test } from "node:test";
import { LatencyInjector } from "../src/latency.js";

test("latency injector clamps settings and drops packets", async () => {
	const injector = new LatencyInjector();
	injector.configure({ latencyMs: -10, jitterMs: 5000, dropRate: 2 });
	assert.deepEqual(injector.settings, {
		latencyMs: 0,
		jitterMs: 2000,
		dropRate: 1,
	});
	assert.equal(injector.shouldDrop(), true);

	injector.configure({ latencyMs: 5, jitterMs: 0, dropRate: 0 });
	const started = Date.now();
	await injector.delay();
	assert.ok(Date.now() - started >= 4);
});
