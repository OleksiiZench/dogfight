import { z } from "zod";
import {
	asEntityId,
	asSeq,
	asTick,
	type CodecName,
	type GameEvent,
	type PlayerId,
	type Result,
} from "../types.ts";

export const PROTOCOL_VERSION: 1 = 1;

export type CloseCode =
	| 1013
	| 4001
	| 4002
	| 4003
	| 4004
	| 4005
	| 4006
	| 4007
	| 4008;

export const CLOSE: {
	readonly INVALID_MESSAGE: 4001;
	readonly OVERSIZE: 4002;
	readonly JOIN_TIMEOUT: 4003;
	readonly RATE_LIMIT: 4004;
	readonly NOT_JOINED: 4005;
	readonly UNKNOWN_ROOM: 4006;
	readonly POLICY: 4007;
	readonly SHUTDOWN: 4008;
	readonly SLOW_CLIENT: 1013;
} = {
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

const ID = /^[a-z0-9][a-z0-9_-]{0,31}$/;
const encoder = new TextEncoder();
const decoder = new TextDecoder();

const boundedText = (name: string, max: number) => {
	const message = `${name} has to be 1..${max} characters`;
	return z
		.string({ error: () => `${name} has to be a string` })
		.transform((value) => value.trim())
		.pipe(z.string().min(1, message).max(max, message));
};

const Integer = z
	.number()
	.int()
	.min(0)
	.max(2 ** 31 - 1);
const FiniteNumber = z
	.number()
	.refine((value) => Number.isFinite(value), "value has to be a number");
const CodecSchema = z.enum(["json", "binary"]);
export const EffectNameSchema = z.enum(["shield", "rapid", "homing", "repair"]);
const PlayerIdSchema = z.string();
const PlayerEntrySchema = z.object({
	id: PlayerIdSchema,
	name: z.string(),
});
const NetSettingsSchema = z.object({
	latencyMs: z.number(),
	jitterMs: z.number(),
	dropRate: z.number(),
});
const ArenaSchema = z.object({ width: z.number(), height: z.number() });
const RoomInfoSchema = z.object({
	id: z.string(),
	name: z.string(),
	seed: z.number(),
	arena: ArenaSchema,
	asteroidTarget: z.number(),
	capacity: z.number(),
	players: z.number(),
	playerNames: z.array(z.string()),
});

export const ClientInputSchema = z.object({
	type: z.literal("input"),
	seq: Integer.transform(asSeq),
	tick: Integer.transform(asTick),
	turn: z.coerce
		.number()
		.refine(Number.isFinite, "turn has to be a number")
		.transform((value) => Math.max(-1, Math.min(1, value))),
	thrust: z.coerce.boolean(),
	fire: z.coerce.boolean(),
});

const ClientJoinSchema = z.object({
	type: z.literal("join"),
	room: boundedText("room", 32).refine(
		(value) => ID.test(value),
		"invalid room id",
	),
	name: boundedText("name", 24),
	codec: z
		.unknown()
		.transform((value): CodecName => (value === "binary" ? "binary" : "json")),
});

const ClientChatSchema = z.object({
	type: z.literal("chat"),
	text: boundedText("text", 240),
});

const ClientPingSchema = z.object({
	type: z.literal("ping"),
	t: z.coerce.number().refine(Number.isFinite, "ping needs t"),
});

const netNumber = (_name: string, max: number) =>
	z
		.unknown()
		.transform((value) => Number(value ?? 0))
		.pipe(FiniteNumber)
		.refine(
			(value) => value >= 0 && value <= max,
			"invalid network simulation settings",
		);

const ClientNetSchema = z.object({
	type: z.literal("net"),
	latencyMs: netNumber("latencyMs", 2000),
	jitterMs: netNumber("jitterMs", 2000),
	dropRate: netNumber("dropRate", 1),
});

const ClientLeaveSchema = z.object({ type: z.literal("leave") });

const makeClientMessageSchema = ({
	nameMaxLength = 24,
	chatMaxLength = 240,
}: {
	nameMaxLength?: number;
	chatMaxLength?: number;
} = {}) =>
	z.discriminatedUnion("type", [
		ClientJoinSchema.extend({ name: boundedText("name", nameMaxLength) }),
		ClientChatSchema.extend({ text: boundedText("text", chatMaxLength) }),
		ClientInputSchema,
		ClientPingSchema,
		ClientNetSchema,
		ClientLeaveSchema,
	]);

export const ClientMessageSchema = makeClientMessageSchema();
export type ClientMessage = z.infer<typeof ClientMessageSchema>;

const BehaviorSnapshotSchema = z.object({
	name: z.string(),
	remaining: z.number().nullable(),
});

const EntityBaseSchema = z.object({
	id: z.number(),
	x: z.number(),
	y: z.number(),
	vx: z.number(),
	vy: z.number(),
	angle: z.number(),
	age: z.number(),
	radius: z.number(),
	behaviors: z.array(BehaviorSnapshotSchema),
});

const EntityDataSchema = z.discriminatedUnion("kind", [
	EntityBaseSchema.extend({
		kind: z.literal("ship"),
		playerId: PlayerIdSchema,
		color: z.string(),
		hp: z.number(),
		maxHp: z.number(),
		fireDelay: z.number(),
		cooldown: z.number(),
		thrusting: z.boolean(),
	}),
	EntityBaseSchema.extend({
		kind: z.literal("bullet"),
		ownerId: PlayerIdSchema,
		sourceSeq: z.number().nullable(),
		ttl: z.number(),
		damage: z.number(),
	}),
	EntityBaseSchema.extend({
		kind: z.literal("asteroid"),
		hp: z.number(),
		spin: z.number(),
		shape: z.array(z.number()),
	}),
	EntityBaseSchema.extend({
		kind: z.literal("pickup"),
		effect: EffectNameSchema,
		ttl: z.number(),
	}),
	EntityBaseSchema.extend({
		kind: z.literal("explosion"),
		color: z.string(),
		life: z.number(),
		particles: z.array(
			z.object({
				x: z.number(),
				y: z.number(),
				vx: z.number(),
				vy: z.number(),
				ttl: z.number(),
			}),
		),
	}),
]);

export const GameEventSchema = z.discriminatedUnion("type", [
	z.object({
		type: z.literal("fired"),
		ownerId: PlayerIdSchema,
		pos: z.object({ x: z.number(), y: z.number() }),
		angle: z.number(),
	}),
	z.object({
		type: z.literal("hit"),
		target: z.enum(["ship", "asteroid"]),
		pos: z.object({ x: z.number(), y: z.number() }),
	}),
	z.object({
		type: z.literal("exploded"),
		pos: z.object({ x: z.number(), y: z.number() }),
		color: z.string(),
	}),
	z.object({
		type: z.literal("shipDestroyed"),
		ship: z.object({
			id: Integer.transform(asEntityId),
			playerId: PlayerIdSchema,
			color: z.string(),
		}),
		killerId: PlayerIdSchema.nullable(),
	}),
	z.object({
		type: z.literal("asteroidDestroyed"),
		killerId: PlayerIdSchema.nullable(),
	}),
	z.object({
		type: z.literal("pickup"),
		effect: EffectNameSchema,
		pos: z.object({ x: z.number(), y: z.number() }),
	}),
	z.object({
		type: z.literal("scoreChanged"),
		scores: z.record(z.string(), z.number()),
	}),
]);

const PlayerStateSchema = z.object({
	id: PlayerIdSchema,
	name: z.string(),
	color: z.string(),
	score: z.number(),
	shipId: z.number().nullable(),
	respawnIn: z.number().nullable(),
});

export const SnapshotMessageSchema = z.object({
	type: z.literal("snapshot"),
	tick: z.number(),
	arena: ArenaSchema,
	players: z.array(PlayerStateSchema),
	entities: z.array(EntityDataSchema),
	events: z.array(GameEventSchema),
	lastProcessedSeq: z.number(),
});

export const ServerMessageSchema = z.discriminatedUnion("type", [
	z.object({
		type: z.literal("hello"),
		protocol: z.number(),
		joinTimeoutMs: z.number(),
		tickRate: z.number(),
		net: NetSettingsSchema,
		codecs: z.array(CodecSchema),
	}),
	z.object({
		type: z.literal("welcome"),
		player: PlayerEntrySchema,
		room: RoomInfoSchema,
		protocol: z.number(),
		codec: CodecSchema,
		tickRate: z.number(),
		net: NetSettingsSchema,
		lastProcessedSeq: z.number(),
	}),
	z.object({
		type: z.literal("error"),
		code: z.number(),
		message: z.string(),
	}),
	z.object({
		type: z.literal("roster"),
		room: z.string().nullable(),
		players: z.array(PlayerEntrySchema),
	}),
	z.object({ type: z.literal("netState"), net: NetSettingsSchema }),
	z.object({
		type: z.literal("pong"),
		t: z.number(),
		serverTime: z.number(),
	}),
	z.object({
		type: z.literal("chat"),
		t: z.string(),
		seq: z.number(),
		room: z.string(),
		player: PlayerEntrySchema,
		text: z.string(),
	}),
	z.object({ type: z.literal("left") }),
	SnapshotMessageSchema,
]);

export type ServerMessage = z.infer<typeof ServerMessageSchema>;
export type SnapshotMessage = z.infer<typeof SnapshotMessageSchema>;
export type NetSettings = z.infer<typeof NetSettingsSchema>;
export type RoomInfo = z.infer<typeof RoomInfoSchema>;

export interface ParseOptions {
	maxPayloadBytes?: number;
	nameMaxLength?: number;
	chatMaxLength?: number;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
	Boolean(value) && typeof value === "object" && !Array.isArray(value);

function byteLength(value: string | Uint8Array): number {
	return typeof value === "string"
		? encoder.encode(value).byteLength
		: value.byteLength;
}

function toBytes(raw: unknown): string | Uint8Array | null {
	if (typeof raw === "string") return raw;
	if (raw instanceof ArrayBuffer) return new Uint8Array(raw);
	if (ArrayBuffer.isView(raw))
		return new Uint8Array(raw.buffer, raw.byteOffset, raw.byteLength);
	return null;
}

function parseEnvelope(
	raw: unknown,
	maxPayloadBytes: number,
): Result<Record<string, unknown>> {
	const bytes = toBytes(raw);
	if (!bytes) {
		return {
			ok: false,
			error: {
				code: CLOSE.INVALID_MESSAGE,
				message: "message has to be an object",
			},
		};
	}
	if (byteLength(bytes) > maxPayloadBytes) {
		return {
			ok: false,
			error: { code: CLOSE.OVERSIZE, message: "message is too large" },
		};
	}
	const text = typeof bytes === "string" ? bytes : decoder.decode(bytes);
	let value: unknown;
	try {
		value = JSON.parse(text);
	} catch {
		return {
			ok: false,
			error: {
				code: CLOSE.INVALID_MESSAGE,
				message: "message is not valid JSON",
			},
		};
	}
	if (!isRecord(value)) {
		return {
			ok: false,
			error: {
				code: CLOSE.INVALID_MESSAGE,
				message: "message has to be an object",
			},
		};
	}
	if (value.v !== PROTOCOL_VERSION) {
		return {
			ok: false,
			error: {
				code: CLOSE.INVALID_MESSAGE,
				message: `unsupported protocol version: ${JSON.stringify(value.v)}`,
			},
		};
	}
	return { ok: true, value };
}

function issueFailure(issue: { message: string }, value: unknown) {
	if (issue.message.startsWith("Invalid discriminator")) {
		const type = isRecord(value) ? value.type : undefined;
		return {
			code: CLOSE.INVALID_MESSAGE,
			message: `unknown message type: ${JSON.stringify(type)}`,
		};
	}
	return { code: CLOSE.INVALID_MESSAGE, message: issue.message };
}

export function parseClientMessage(
	raw: unknown,
	options: ParseOptions = {},
): Result<ClientMessage> {
	const parsed = parseEnvelope(raw, options.maxPayloadBytes ?? 4096);
	if (!parsed.ok) return { ok: false, error: parsed.error };
	const schema = makeClientMessageSchema({
		nameMaxLength: options.nameMaxLength,
		chatMaxLength: options.chatMaxLength,
	});
	const result = schema.safeParse(parsed.value);
	if (!result.success) {
		const issue = result.error.issues[0];
		return {
			ok: false,
			error: issueFailure(
				issue ?? { message: "invalid message" },
				parsed.value,
			),
		};
	}
	return { ok: true, value: result.data };
}

export function parseServerMessage(raw: unknown): Result<ServerMessage> {
	const parsed = parseEnvelope(raw, 1024 * 1024);
	if (!parsed.ok) return { ok: false, error: parsed.error };
	const result = ServerMessageSchema.safeParse(parsed.value);
	if (!result.success) {
		const issue = result.error.issues[0];
		return {
			ok: false,
			error: issueFailure(
				issue ?? { message: "invalid message" },
				parsed.value,
			),
		};
	}
	return { ok: true, value: result.data };
}

export const EVENT_NAMES: Readonly<Record<string, GameEvent["type"]>> = {
	FIRED: "fired",
	HIT: "hit",
	EXPLODED: "exploded",
	SHIP_DESTROYED: "shipDestroyed",
	ASTEROID_DESTROYED: "asteroidDestroyed",
	PICKUP: "pickup",
	SCORE_CHANGED: "scoreChanged",
};

export type { PlayerId };
