import { describe, expect, test } from "vitest";
import {
	codecs,
	DEFAULT_INPUT,
	encodeInput,
	encodeMessage,
	encodeSnapshot,
	intentOf,
	parseBinaryClientMessage,
	parseBinaryServerMessage,
	parseClientMessage,
	parseServerMessage,
	readInput,
	updateInput,
	validateInput,
	validateSnapshot,
} from "../src/protocol.ts";
import type { BinarySource, Snapshot, WirePayload } from "../src/types.ts";

const arena = { width: 800, height: 600 };

function toBytes(value: WirePayload): BinarySource {
	if (typeof value === "string") throw new Error("expected binary payload");
	return value;
}

function snapshot(): Snapshot {
	return {
		type: "snapshot",
		tick: 1,
		arena,
		players: [],
		entities: [],
		events: [],
		lastProcessedSeq: 0,
	};
}

describe("binary protocol facade", () => {
	test("parseBinaryClientMessage accepts input messages", () => {
		const result = parseBinaryClientMessage(
			toBytes(encodeInput({ seq: 3, tick: 2, turn: 0.25 })),
		);
		expect(result.ok).toBe(true);
	});

	test("parseBinaryClientMessage rejects oversize payloads", () => {
		const result = parseBinaryClientMessage(
			toBytes(encodeInput({ seq: 3, tick: 2, turn: 0 })),
			{ maxPayloadBytes: 2 },
		);
		expect(result).toMatchObject({ ok: false });
	});

	test("parseBinaryClientMessage rejects snapshots", () => {
		const result = parseBinaryClientMessage(
			toBytes(encodeSnapshot(snapshot())),
		);
		expect(result).toMatchObject({
			ok: false,
			error: { message: "client message has to be an input" },
		});
	});

	test("parseBinaryClientMessage reports decode failures", () => {
		const result = parseBinaryClientMessage(new TextEncoder().encode("x"));
		expect(result.ok).toBe(false);
	});

	test("parseBinaryServerMessage accepts snapshots", () => {
		const result = parseBinaryServerMessage(
			toBytes(encodeSnapshot(snapshot())),
		);
		expect(result.ok).toBe(true);
	});

	test("parseBinaryServerMessage rejects inputs", () => {
		const result = parseBinaryServerMessage(
			toBytes(encodeInput({ seq: 1, tick: 1, turn: 0 })),
		);
		expect(result).toMatchObject({
			ok: false,
			error: { message: "server message has to be a snapshot" },
		});
	});

	test("parseBinaryServerMessage reports decode failures", () => {
		expect(parseBinaryServerMessage(new TextEncoder().encode("x")).ok).toBe(
			false,
		);
	});

	test("json and binary codecs round-trip", () => {
		const message = { type: "leave" };
		expect(codecs.json.decode(codecs.json.encode(message))).toMatchObject(
			message,
		);
		expect(
			codecs.binary.decode(
				toBytes(
					encodeInput({ seq: 1, tick: 1, turn: 0, thrust: true, fire: false }),
				),
			),
		).toMatchObject({ type: "input", seq: 1 });
	});

	test("binary codec rejects text payloads", () => {
		expect(() => codecs.binary.decode("{}")).toThrow(/binary data/);
	});

	test("encodeMessage supports both codecs", () => {
		expect(encodeMessage({ type: "leave" })).toBe('{"v":1,"type":"leave"}');
		expect(
			toBytes(encodeMessage(snapshot(), "binary")).byteLength,
		).toBeGreaterThan(0);
	});
});

describe("input helpers", () => {
	test("intentOf returns an empty intent for null", () => {
		expect(intentOf(null)).toEqual({
			turn: 0,
			thrust: false,
			fire: false,
		});
	});

	test("intentOf converts sequence numbers", () => {
		expect(
			intentOf({ seq: 7, tick: 6, turn: 1, thrust: true, fire: false }),
		).toMatchObject({
			seq: 7,
			turn: 1,
			thrust: true,
		});
	});

	test("readInput clamps turn and coerces flags", () => {
		expect(
			readInput({ turn: 12, thrust: true, fire: false }, 1, 2),
		).toMatchObject({ turn: 1, thrust: true, fire: false });
		expect(readInput({ turn: Number.NaN }, 1, 2).turn).toBe(0);
	});

	test("updateInput accepts newer sequences only", () => {
		const state: Record<string, { seq: number; tick: number }> = {};
		expect(updateInput({}, "p1", { ...DEFAULT_INPUT, seq: 1, tick: 1 })).toBe(
			true,
		);
		const withOne = { p1: { ...DEFAULT_INPUT, seq: 1, tick: 1 } };
		expect(updateInput(withOne, "p1", { ...DEFAULT_INPUT, seq: 1 })).toBe(
			false,
		);
		expect(state).toEqual({});
	});

	test("validateInput accepts valid input", () => {
		expect(
			validateInput({
				v: 1,
				type: "input",
				seq: 1,
				tick: 1,
				turn: 0,
				thrust: false,
				fire: false,
			}),
		).toMatchObject({ ok: true });
	});

	test("validateInput reports invalid input", () => {
		expect(validateInput({ v: 1, type: "input", seq: -1 })).toMatchObject({
			ok: false,
		});
	});

	test("validateSnapshot accepts a snapshot", () => {
		expect(
			validateSnapshot({
				v: 1,
				...snapshot(),
				events: [],
				lastProcessedSeq: 0,
			}),
		).toMatchObject({ ok: true });
	});

	test("validateSnapshot reports invalid snapshot", () => {
		expect(validateSnapshot({ v: 1, type: "snapshot" })).toMatchObject({
			ok: false,
		});
	});
});

describe("JSON protocol facade", () => {
	const json = (value: object) => JSON.stringify(value);

	test("parseClientMessage accepts join, chat and net", () => {
		expect(
			parseClientMessage(
				json({ v: 1, type: "join", room: "r", name: "A", codec: "json" }),
			).ok,
		).toBe(true);
		expect(
			parseClientMessage(json({ v: 1, type: "chat", text: "hi" })).ok,
		).toBe(true);
		expect(
			parseClientMessage(
				json({
					v: 1,
					type: "net",
					latencyMs: 10,
					jitterMs: 2,
					dropRate: 0,
				}),
			).ok,
		).toBe(true);
	});

	test("parseClientMessage rejects bad envelope and type", () => {
		expect(parseClientMessage(json({ v: 2, type: "leave" })).ok).toBe(false);
		expect(parseClientMessage(json({ v: 1, type: "unknown" })).ok).toBe(false);
	});

	test("parseClientMessage enforces payload limit", () => {
		expect(
			parseClientMessage(json({ v: 1, type: "chat", text: "hello" }), {
				maxPayloadBytes: 4,
			}).ok,
		).toBe(false);
	});

	test("parseServerMessage accepts hello and rejects garbage", () => {
		expect(
			parseServerMessage(
				json({
					v: 1,
					type: "hello",
					protocol: 1,
					joinTimeoutMs: 5000,
					tickRate: 30,
					net: { latencyMs: 0, jitterMs: 0, dropRate: 0 },
					codecs: ["json"],
				}),
			).ok,
		).toBe(true);
		expect(parseServerMessage(json({ v: 1, type: "nope" })).ok).toBe(false);
	});
});
