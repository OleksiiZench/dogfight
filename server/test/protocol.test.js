import assert from "node:assert/strict";
import { test } from "node:test";
import { encodeInput } from "shared/protocol/codec.js";
import {
	CLOSE,
	decodeBinaryClientMessage,
	decodeClientMessage,
	encodeMessage,
	ProtocolError,
} from "../src/protocol.js";

test("decodes valid join, chat and leave", () => {
	assert.deepEqual(
		decodeClientMessage(
			'{"v":1,"type":"join","room":"training","name":"Alpha"}',
		),
		{ type: "join", room: "training", name: "Alpha", codec: "json" },
	);
	assert.deepEqual(decodeClientMessage('{"v":1,"type":"chat","text":"hi"}'), {
		type: "chat",
		text: "hi",
	});
	assert.deepEqual(decodeClientMessage('{"v":1,"type":"leave"}'), {
		type: "leave",
	});
	assert.equal(encodeMessage({ type: "leave" }), '{"v":1,"type":"leave"}');
	assert.deepEqual(
		decodeClientMessage(
			'{"v":1,"type":"input","seq":5,"tick":2,"turn":4,"thrust":true,"fire":false}',
		),
		{ type: "input", seq: 5, tick: 2, turn: 1, thrust: true, fire: false },
	);
	assert.deepEqual(
		decodeBinaryClientMessage(
			encodeInput({ seq: 6, tick: 3, turn: -0.5, thrust: true, fire: true }),
		),
		{ type: "input", seq: 6, tick: 3, turn: -0.5, thrust: true, fire: true },
	);
	assert.deepEqual(decodeClientMessage('{"v":1,"type":"ping","t":12.5}'), {
		type: "ping",
		t: 12.5,
	});
	assert.deepEqual(
		decodeClientMessage(
			'{"v":1,"type":"net","latencyMs":100,"jitterMs":30,"dropRate":0.02}',
		),
		{ type: "net", latencyMs: 100, jitterMs: 30, dropRate: 0.02 },
	);
});

test("rejects unknown, malformed, outdated and oversize messages", () => {
	assert.throws(
		() => decodeClientMessage('{"v":1,"type":"unknown"}'),
		(error) =>
			error instanceof ProtocolError && error.code === CLOSE.INVALID_MESSAGE,
	);
	assert.throws(
		() => decodeClientMessage("not json"),
		(error) =>
			error instanceof ProtocolError && error.code === CLOSE.INVALID_MESSAGE,
	);
	assert.throws(
		() => decodeClientMessage('{"v":2,"type":"leave"}'),
		(error) =>
			error instanceof ProtocolError && error.code === CLOSE.INVALID_MESSAGE,
	);
	assert.throws(
		() =>
			decodeClientMessage('{"v":1,"type":"chat","text":"x"}', {
				maxPayloadBytes: 8,
			}),
		(error) => error instanceof ProtocolError && error.code === CLOSE.OVERSIZE,
	);
	assert.throws(
		() => decodeClientMessage('{"v":1,"type":"input","seq":-1,"tick":0}'),
		(error) =>
			error instanceof ProtocolError && error.code === CLOSE.INVALID_MESSAGE,
	);
	assert.throws(
		() => decodeClientMessage('{"v":1,"type":"net","dropRate":3}'),
		(error) =>
			error instanceof ProtocolError && error.code === CLOSE.INVALID_MESSAGE,
	);
});
