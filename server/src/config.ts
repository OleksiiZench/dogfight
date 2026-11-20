import { resolve } from "node:path";
import { z } from "zod";

export const rootDir = resolve(import.meta.dirname, "../..");

function numeric(
	name: string,
	fallback: number,
	min: number,
	max: number,
	integer = true,
) {
	const base = z
		.number({ error: () => `${name} has to be a number` })
		.refine((value) => Number.isFinite(value), `${name} has to be a number`)
		.min(min, `${name} has to be between ${min} and ${max}`)
		.max(max, `${name} has to be between ${min} and ${max}`);
	const bounded = integer
		? base.refine(
				(value) => Number.isInteger(value),
				`${name} has to be an integer`,
			)
		: base;
	return z.preprocess(
		(raw) => (raw === undefined || raw === "" ? fallback : Number(raw)),
		bounded,
	);
}

function text(name: string, fallback: string) {
	return z
		.string({ error: () => `${name} has to be a string` })
		.trim()
		.min(1, `${name} cannot be empty`)
		.default(fallback);
}

const EnvSchema = z
	.object({
		HOST: text("HOST", "127.0.0.1"),
		PORT: numeric("PORT", 3001, 1, 65535),
		LOG_DIR: text("LOG_DIR", ".logs"),
		MAX_ROOMS: numeric("MAX_ROOMS", 50, 1, 10000),
		MAX_PLAYERS_PER_ROOM: numeric("MAX_PLAYERS_PER_ROOM", 8, 1, 100),
		MAX_PAYLOAD: numeric("MAX_PAYLOAD", 4096, 256, 1024 * 1024),
		MESSAGES_PER_SECOND: numeric("MESSAGES_PER_SECOND", 90, 1, 1000),
		TICK_RATE: numeric("TICK_RATE", 30, 1, 120),
		LATENCY_MS: numeric("LATENCY_MS", 0, 0, 2000),
		JITTER_MS: numeric("JITTER_MS", 0, 0, 2000),
		DROP_RATE: numeric("DROP_RATE", 0, 0, 1, false),
		INTERPOLATION_DELAY_MS: numeric("INTERPOLATION_DELAY_MS", 66, 0, 1000),
		JOIN_TIMEOUT_MS: numeric("JOIN_TIMEOUT_MS", 5000, 100, 60000),
		PING_INTERVAL_MS: numeric("PING_INTERVAL_MS", 15000, 1000, 300000),
		MAX_MISSED_PONGS: numeric("MAX_MISSED_PONGS", 2, 1, 10),
		SLOW_CLIENT_BUFFER_BYTES: numeric(
			"SLOW_CLIENT_BUFFER_BYTES",
			1024 * 1024,
			1024,
			64 * 1024 * 1024,
		),
		NAME_MAX_LENGTH: numeric("NAME_MAX_LENGTH", 24, 1, 128),
		CHAT_MAX_LENGTH: numeric("CHAT_MAX_LENGTH", 240, 1, 2048),
		BODY_MAX_BYTES: numeric("BODY_MAX_BYTES", 8192, 256, 1024 * 1024),
		BLOCK_MS: numeric("BLOCK_MS", 300, 0, 5000),
	})
	.transform((env) => ({
		host: env.HOST,
		port: env.PORT,
		logDir: resolve(rootDir, env.LOG_DIR),
		clientDist: resolve(rootDir, "client/dist"),
		roomsFile: resolve(rootDir, "server/data/rooms.json"),
		maxRooms: env.MAX_ROOMS,
		maxPlayersPerRoom: env.MAX_PLAYERS_PER_ROOM,
		maxPayloadBytes: env.MAX_PAYLOAD,
		messagesPerSecond: env.MESSAGES_PER_SECOND,
		tickRate: env.TICK_RATE,
		latencyMs: env.LATENCY_MS,
		jitterMs: env.JITTER_MS,
		dropRate: env.DROP_RATE,
		interpolationDelayMs: env.INTERPOLATION_DELAY_MS,
		joinTimeoutMs: env.JOIN_TIMEOUT_MS,
		pingIntervalMs: env.PING_INTERVAL_MS,
		maxMissedPongs: env.MAX_MISSED_PONGS,
		slowClientBufferBytes: env.SLOW_CLIENT_BUFFER_BYTES,
		nameMaxLength: env.NAME_MAX_LENGTH,
		chatMaxLength: env.CHAT_MAX_LENGTH,
		bodyMaxBytes: env.BODY_MAX_BYTES,
		blockMs: env.BLOCK_MS,
	}));

export function loadConfig(
	env: Readonly<Record<string, string | undefined>> = process.env,
) {
	const result = EnvSchema.safeParse(env);
	if (!result.success) {
		throw new Error(result.error.issues[0]?.message ?? "invalid config");
	}
	return result.data;
}

export type ServerConfig = ReturnType<typeof loadConfig>;
