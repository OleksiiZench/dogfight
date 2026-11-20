import assert from "node:assert/strict";
import { test } from "node:test";
import {
	decodeBinaryMessage,
	decodeInput,
	decodeSnapshot,
	encodeInput,
	encodeSnapshot,
} from "../src/protocol/codec.ts";
import type { Snapshot } from "../src/types.ts";

const isRecord = (value: unknown): value is Record<string, unknown> =>
	Boolean(value) && typeof value === "object" && !Array.isArray(value);

function assertClose(actual: unknown, expected: unknown, path = "value"): void {
	if (typeof expected === "number") {
		assert.equal(typeof actual, "number", `${path} must be a number`);
		assert.ok(
			typeof actual === "number" && Math.abs(actual - expected) <= 0.011,
			`${path}: ${String(actual)} != ${expected}`,
		);
		return;
	}
	if (Array.isArray(expected)) {
		assert.ok(Array.isArray(actual), `${path} must be an array`);
		assert.equal(actual.length, expected.length, `${path} length`);
		for (let i = 0; i < expected.length; i++) {
			assertClose(actual[i], expected[i], `${path}[${i}]`);
		}
		return;
	}
	if (expected && typeof expected === "object") {
		assert.ok(isRecord(actual), `${path} must be an object`);
		for (const [key, value] of Object.entries(expected)) {
			assertClose(actual[key], value, `${path}.${key}`);
		}
		return;
	}
	assert.equal(actual, expected, path);
}

const snapshot: Snapshot = {
	type: "snapshot",
	tick: 42,
	arena: { width: 1280, height: 720 },
	players: [
		{
			id: "p1",
			name: "Alpha",
			color: "#ff0000",
			score: 3,
			shipId: 1,
			respawnIn: null,
		},
		{
			id: "p2",
			name: "Beta",
			color: "#0000ff",
			score: -2,
			shipId: null,
			respawnIn: 1.5,
		},
	],
	entities: [
		{
			id: 1,
			kind: "ship",
			x: 100.25,
			y: 200.5,
			vx: 3.125,
			vy: -2.5,
			angle: 0.785,
			age: 1.23,
			radius: 14.5,
			behaviors: [{ name: "shield", remaining: 1.25 }],
			playerId: "p1",
			color: "#ff0000",
			hp: 80,
			maxHp: 100,
			fireDelay: 0.25,
			cooldown: 0.125,
			thrusting: true,
		},
		{
			id: 2,
			kind: "bullet",
			x: 120,
			y: 210,
			vx: 500,
			vy: 10,
			angle: 0.02,
			age: 0.12,
			radius: 2.5,
			behaviors: [],
			ownerId: "p1",
			sourceSeq: 7,
			ttl: 1.2,
			damage: 20,
		},
		{
			id: 3,
			kind: "asteroid",
			x: 800,
			y: 400,
			vx: -30,
			vy: 45,
			angle: 1.5,
			age: 10,
			radius: 38,
			behaviors: [{ name: "homing", remaining: null }],
			hp: 3,
			spin: 0.5,
			shape: [1, 0.82, 1.23],
		},
		{
			id: 4,
			kind: "pickup",
			x: 640,
			y: 360,
			vx: 0,
			vy: 0,
			angle: 0,
			age: 2,
			radius: 12,
			behaviors: [],
			effect: "rapid",
			ttl: 5,
		},
		{
			id: 5,
			kind: "explosion",
			x: 300,
			y: 300,
			vx: 0,
			vy: 0,
			angle: 0,
			age: 0.2,
			radius: 20,
			behaviors: [],
			color: "#ffffff",
			life: 0.4,
			particles: [
				{ x: 1, y: 2, vx: 3, vy: 4, ttl: 0.2 },
				{ x: -1, y: -2, vx: -3, vy: -4, ttl: 0.15 },
			],
		},
	],
	events: [{ type: "scoreChanged", scores: { p1: 3, p2: -2 } }],
	lastProcessedSeq: 11,
};

test("input round-trips through the versioned binary codec", () => {
	const input = { seq: 42, tick: 9, turn: 0.375, thrust: true, fire: false };
	const decoded = decodeInput(encodeInput(input));
	assert.equal(decoded.type, "input");
	assert.equal(decoded.seq, 42);
	assert.equal(decoded.tick, 9);
	assert.ok(Math.abs(decoded.turn - 0.375) <= 0.001);
	assert.equal(decoded.thrust, true);
	assert.equal(decoded.fire, false);
	assert.deepEqual(decodeBinaryMessage(encodeInput(input)), decoded);
});

test("snapshot round-trips within quantization tolerance", () => {
	assertClose(decodeSnapshot(encodeSnapshot(snapshot)), snapshot);
	assertClose(decodeBinaryMessage(encodeSnapshot(snapshot)), snapshot);
});

test("binary codec rejects unknown versions and types", () => {
	const bytes = new Uint8Array(encodeInput({ seq: 1, tick: 1, turn: 0 }));
	bytes[0] = 9;
	assert.throws(() => decodeInput(bytes.buffer), /unsupported codec version/);
	bytes[0] = 1;
	bytes[1] = 9;
	assert.throws(
		() => decodeBinaryMessage(bytes.buffer),
		/unknown binary message/,
	);
});
