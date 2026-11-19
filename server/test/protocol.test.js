import assert from "node:assert/strict";
import { test } from "node:test";
import {
	CLOSE,
	decodeClientMessage,
	encodeMessage,
	ProtocolError,
} from "../src/protocol.js";

test("decodes valid join, chat and leave", () => {
	assert.deepEqual(
		decodeClientMessage(
			'{"v":1,"type":"join","room":"training","name":"Alpha"}',
		),
		{ type: "join", room: "training", name: "Alpha" },
	);
	assert.deepEqual(decodeClientMessage('{"v":1,"type":"chat","text":"hi"}'), {
		type: "chat",
		text: "hi",
	});
	assert.deepEqual(decodeClientMessage('{"v":1,"type":"leave"}'), {
		type: "leave",
	});
	assert.equal(encodeMessage({ type: "leave" }), '{"v":1,"type":"leave"}');
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
});
