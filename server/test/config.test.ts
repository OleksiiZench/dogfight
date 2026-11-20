import assert from "node:assert/strict";
import { test } from "node:test";
import { loadConfig } from "../src/config.js";

test("config uses safe defaults", () => {
	const config = loadConfig({});
	assert.equal(config.port, 3001);
	assert.equal(config.host, "127.0.0.1");
	assert.equal(config.joinTimeoutMs, 5000);
	assert.equal(config.pingIntervalMs, 15000);
	assert.equal(config.maxMissedPongs, 2);
	assert.equal(config.tickRate, 30);
	assert.equal(config.messagesPerSecond, 90);
	assert.equal(config.dropRate, 0);
	assert.ok(config.logDir.endsWith(".logs"));
});

test("config rejects invalid values", () => {
	assert.throws(() => loadConfig({ PORT: "0" }), /PORT/);
	assert.throws(() => loadConfig({ PORT: "abc" }), /PORT/);
	assert.throws(() => loadConfig({ MAX_PAYLOAD: "12" }), /MAX_PAYLOAD/);
	assert.throws(() => loadConfig({ LOG_DIR: "   " }), /LOG_DIR/);
	assert.throws(() => loadConfig({ DROP_RATE: "1.5" }), /DROP_RATE/);
	assert.throws(() => loadConfig({ TICK_RATE: "0" }), /TICK_RATE/);
});
