import {
	ProtocolError,
	parseBinaryClientMessage,
	parseClientMessage,
} from "shared/protocol.ts";

export { encodeMessage } from "shared/protocol/codec.ts";
export { CLOSE, PROTOCOL_VERSION, ProtocolError } from "shared/protocol.ts";

import type { ParseOptions } from "shared/protocol/schema.ts";
import type { ClientMessage } from "shared/protocol.ts";
import type { BinarySource, InputMessage } from "shared/types.ts";

const decoder = new TextDecoder();

function isRecord(value: unknown): value is Record<string, unknown> {
	return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function toText(raw: unknown): string | null {
	if (typeof raw === "string") return raw;
	if (raw instanceof ArrayBuffer) return decoder.decode(raw);
	if (ArrayBuffer.isView(raw))
		return decoder.decode(
			new Uint8Array(raw.buffer, raw.byteOffset, raw.byteLength),
		);
	return null;
}

function withDefaultJoinCodec(raw: unknown): unknown {
	const text = toText(raw);
	if (text === null) return raw;
	try {
		const value: unknown = JSON.parse(text);
		if (isRecord(value) && value.type === "join" && !("codec" in value)) {
			return JSON.stringify({ ...value, codec: "json" });
		}
	} catch {
		return raw;
	}
	return raw;
}

export function decodeClientMessage(
	raw: unknown,
	options: ParseOptions = {},
): ClientMessage {
	const result = parseClientMessage(withDefaultJoinCodec(raw), options);
	if (!result.ok) {
		throw new ProtocolError(result.error.code, result.error.message);
	}
	return result.value;
}

export function decodeBinaryClientMessage(
	raw: BinarySource,
	options: { maxPayloadBytes?: number } = {},
): InputMessage {
	const result = parseBinaryClientMessage(raw, options);
	if (!result.ok) {
		throw new ProtocolError(result.error.code, result.error.message);
	}
	return result.value;
}
