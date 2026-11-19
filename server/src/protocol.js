export const PROTOCOL_VERSION = 1;

export const CLOSE = {
	INVALID_MESSAGE: 4001,
	OVERSIZE: 4002,
	JOIN_TIMEOUT: 4003,
	RATE_LIMIT: 4004,
	NOT_JOINED: 4005,
	UNKNOWN_ROOM: 4006,
	POLICY: 4007,
	SHUTDOWN: 4008,
	SLOW_CLIENT: 1013,
};

export class ProtocolError extends Error {
	constructor(code, message) {
		super(message);
		this.name = "ProtocolError";
		this.code = code;
	}
}

const ID = /^[a-z0-9][a-z0-9_-]{0,31}$/;

function boundedText(value, name, maxLength, code = CLOSE.INVALID_MESSAGE) {
	if (typeof value !== "string") {
		throw new ProtocolError(code, `${name} has to be a string`);
	}
	const text = value.trim();
	if (!text || text.length > maxLength) {
		throw new ProtocolError(
			code,
			`${name} has to be 1..${maxLength} characters`,
		);
	}
	return text;
}

function parse(raw, maxPayloadBytes) {
	const text = typeof raw === "string" ? raw : raw.toString("utf8");
	if (Buffer.byteLength(text) > maxPayloadBytes) {
		throw new ProtocolError(CLOSE.OVERSIZE, "message is too large");
	}
	let value;
	try {
		value = JSON.parse(text);
	} catch {
		throw new ProtocolError(CLOSE.INVALID_MESSAGE, "message is not valid JSON");
	}
	if (!value || typeof value !== "object" || Array.isArray(value)) {
		throw new ProtocolError(
			CLOSE.INVALID_MESSAGE,
			"message has to be an object",
		);
	}
	if (value.v !== PROTOCOL_VERSION) {
		throw new ProtocolError(
			CLOSE.INVALID_MESSAGE,
			`unsupported protocol version: ${JSON.stringify(value.v)}`,
		);
	}
	return value;
}

export function decodeClientMessage(raw, options = {}) {
	const {
		maxPayloadBytes = 4096,
		nameMaxLength = 24,
		chatMaxLength = 240,
	} = options;
	const value = parse(raw, maxPayloadBytes);

	switch (value.type) {
		case "join": {
			const room = boundedText(value.room, "room", 32);
			if (!ID.test(room)) {
				throw new ProtocolError(CLOSE.INVALID_MESSAGE, "invalid room id");
			}
			return {
				type: "join",
				room,
				name: boundedText(value.name, "name", nameMaxLength),
			};
		}
		case "chat":
			return {
				type: "chat",
				text: boundedText(value.text, "text", chatMaxLength),
			};
		case "leave":
			return { type: "leave" };
		default:
			throw new ProtocolError(
				CLOSE.INVALID_MESSAGE,
				`unknown message type: ${value.type}`,
			);
	}
}

export function encodeMessage(message) {
	return JSON.stringify({ v: PROTOCOL_VERSION, ...message });
}
