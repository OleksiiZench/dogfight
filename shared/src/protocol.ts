export * from "./protocol/codec.ts";
export * from "./protocol/input.ts";
export * from "./protocol/schema.ts";
export * from "./protocol/snapshot.ts";

import { decodeBinaryMessage, encodeMessage } from "./protocol/codec.ts";
import type { ServerMessage } from "./protocol/schema.ts";
import {
	CLOSE,
	PROTOCOL_VERSION,
	parseClientMessage,
	parseServerMessage,
} from "./protocol/schema.ts";
import type {
	BinarySource,
	CodecName,
	InputMessage,
	Result,
	WirePayload,
} from "./types.ts";

export class ProtocolError extends Error {
	readonly code: number;

	constructor(code: number, message: string) {
		super(message);
		this.name = "ProtocolError";
		this.code = code;
	}
}

const decoder = new TextDecoder();

function decodeText(data: BinarySource | string): string {
	if (typeof data === "string") return data;
	if (data instanceof ArrayBuffer) return decoder.decode(data);
	const copy = new Uint8Array(data.byteLength);
	copy.set(new Uint8Array(data.buffer, data.byteOffset, data.byteLength));
	return decoder.decode(copy);
}

function errorMessage(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

function byteLength(data: BinarySource | string): number {
	if (typeof data === "string")
		return new TextEncoder().encode(data).byteLength;
	if (data instanceof ArrayBuffer) return data.byteLength;
	return data.byteLength;
}

export function parseBinaryClientMessage(
	data: BinarySource,
	options: { maxPayloadBytes?: number } = {},
): Result<InputMessage> {
	const max = options.maxPayloadBytes ?? 4096;
	if (byteLength(data) > max) {
		return {
			ok: false,
			error: { code: CLOSE.OVERSIZE, message: "message is too large" },
		};
	}
	try {
		const message = decodeBinaryMessage(data);
		if (message.type !== "input") {
			return {
				ok: false,
				error: {
					code: CLOSE.INVALID_MESSAGE,
					message: "client message has to be an input",
				},
			};
		}
		return { ok: true, value: message };
	} catch (error) {
		return {
			ok: false,
			error: {
				code: CLOSE.INVALID_MESSAGE,
				message: errorMessage(error),
			},
		};
	}
}

export function parseBinaryServerMessage(
	data: BinarySource,
): Result<ServerMessage> {
	try {
		const message = decodeBinaryMessage(data);
		if (message.type !== "snapshot") {
			return {
				ok: false,
				error: {
					code: CLOSE.INVALID_MESSAGE,
					message: "server message has to be a snapshot",
				},
			};
		}
		return { ok: true, value: message };
	} catch (error) {
		return {
			ok: false,
			error: {
				code: CLOSE.INVALID_MESSAGE,
				message: errorMessage(error),
			},
		};
	}
}

export interface Codec {
	readonly name: CodecName;
	encode(message: object): WirePayload;
	decode(data: BinarySource | string): unknown;
}

export const codecs: Record<CodecName, Codec> = {
	json: {
		name: "json",
		encode(message) {
			return encodeMessage(message, "json");
		},
		decode(data) {
			const value: unknown = JSON.parse(decodeText(data));
			return value;
		},
	},
	binary: {
		name: "binary",
		encode(message) {
			return encodeMessage(message, "binary");
		},
		decode(data) {
			if (typeof data === "string") {
				throw new ProtocolError(
					CLOSE.INVALID_MESSAGE,
					"binary codec needs binary data",
				);
			}
			return decodeBinaryMessage(data);
		},
	},
};

export { PROTOCOL_VERSION, parseClientMessage, parseServerMessage };
