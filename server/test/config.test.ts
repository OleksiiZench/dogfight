import assert from "node:assert/strict";
import { test } from "vitest";
import { loadConfig } from "../src/config.ts";

test("config uses safe defaults", () => {
	const config = loadConfig({});
	assert.equal(config.port, 3001);
	assert.equal(config.host, "0.0.0.0");
	assert.equal(config.joinTimeoutMs, 5000);
	assert.equal(config.pingIntervalMs, 15000);
	assert.equal(config.maxMissedPongs, 2);
	assert.equal(config.tickRate, 30);
	assert.equal(config.messagesPerSecond, 90);
	assert.equal(config.dropRate, 0);
	assert.ok(config.logDir.endsWith(".logs"));
	assert.equal(config.nodeEnv, "development");
	assert.equal(config.logLevel, "info");
	assert.deepEqual(config.allowedOrigins, ["*"]);
	assert.equal(config.maxConnectionsPerIp, 256);
});

test("config parses origins and production settings", () => {
	const config = loadConfig({
		NODE_ENV: "production",
		LOG_LEVEL: "warn",
		VERSION: "abc123",
		ALLOWED_ORIGINS: "https://a.example, https://b.example",
		MAX_CONNECTIONS_PER_IP: "8",
	});
	assert.equal(config.nodeEnv, "production");
	assert.equal(config.logLevel, "warn");
	assert.equal(config.version, "abc123");
	assert.deepEqual(config.allowedOrigins, [
		"https://a.example",
		"https://b.example",
	]);
	assert.equal(config.maxConnectionsPerIp, 8);
});

test("config rejects invalid values", () => {
	assert.throws(() => loadConfig({ PORT: "0" }), /PORT/);
	assert.throws(() => loadConfig({ PORT: "abc" }), /PORT/);
	assert.throws(() => loadConfig({ MAX_PAYLOAD: "12" }), /MAX_PAYLOAD/);
	assert.throws(() => loadConfig({ LOG_DIR: "   " }), /LOG_DIR/);
	assert.throws(() => loadConfig({ DROP_RATE: "1.5" }), /DROP_RATE/);
	assert.throws(() => loadConfig({ TICK_RATE: "0" }), /TICK_RATE/);
});
