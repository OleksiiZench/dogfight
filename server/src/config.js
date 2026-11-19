import { resolve } from "node:path";

export const rootDir = resolve(import.meta.dirname, "../..");

function number(name, raw, { fallback, min, max }) {
	const value = raw === undefined || raw === "" ? fallback : Number(raw);
	if (!Number.isFinite(value) || !Number.isInteger(value)) {
		throw new Error(`${name} has to be an integer, got ${JSON.stringify(raw)}`);
	}
	if (value < min || value > max) {
		throw new Error(
			`${name} has to be between ${min} and ${max}, got ${value}`,
		);
	}
	return value;
}

function text(name, raw, fallback) {
	const value = raw === undefined || raw === "" ? fallback : String(raw).trim();
	if (!value) throw new Error(`${name} cannot be empty`);
	return value;
}

export function loadConfig(env = process.env) {
	const config = {
		host: text("HOST", env.HOST, "127.0.0.1"),
		port: number("PORT", env.PORT, { fallback: 3001, min: 1, max: 65535 }),
		logDir: resolve(rootDir, text("LOG_DIR", env.LOG_DIR, ".logs")),
		clientDist: resolve(rootDir, "client/dist"),
		roomsFile: resolve(rootDir, "server/data/rooms.json"),
		maxRooms: number("MAX_ROOMS", env.MAX_ROOMS, {
			fallback: 50,
			min: 1,
			max: 10000,
		}),
		maxPlayersPerRoom: number(
			"MAX_PLAYERS_PER_ROOM",
			env.MAX_PLAYERS_PER_ROOM,
			{
				fallback: 8,
				min: 1,
				max: 100,
			},
		),
		maxPayloadBytes: number("MAX_PAYLOAD", env.MAX_PAYLOAD, {
			fallback: 4096,
			min: 256,
			max: 1024 * 1024,
		}),
		messagesPerSecond: number("MESSAGES_PER_SECOND", env.MESSAGES_PER_SECOND, {
			fallback: 20,
			min: 1,
			max: 1000,
		}),
		joinTimeoutMs: number("JOIN_TIMEOUT_MS", env.JOIN_TIMEOUT_MS, {
			fallback: 5000,
			min: 100,
			max: 60000,
		}),
		pingIntervalMs: number("PING_INTERVAL_MS", env.PING_INTERVAL_MS, {
			fallback: 15000,
			min: 1000,
			max: 300000,
		}),
		maxMissedPongs: number("MAX_MISSED_PONGS", env.MAX_MISSED_PONGS, {
			fallback: 2,
			min: 1,
			max: 10,
		}),
		slowClientBufferBytes: number(
			"SLOW_CLIENT_BUFFER_BYTES",
			env.SLOW_CLIENT_BUFFER_BYTES,
			{ fallback: 1024 * 1024, min: 1024, max: 64 * 1024 * 1024 },
		),
		nameMaxLength: number("NAME_MAX_LENGTH", env.NAME_MAX_LENGTH, {
			fallback: 24,
			min: 1,
			max: 128,
		}),
		chatMaxLength: number("CHAT_MAX_LENGTH", env.CHAT_MAX_LENGTH, {
			fallback: 240,
			min: 1,
			max: 2048,
		}),
		bodyMaxBytes: number("BODY_MAX_BYTES", env.BODY_MAX_BYTES, {
			fallback: 8192,
			min: 256,
			max: 1024 * 1024,
		}),
		blockMs: number("BLOCK_MS", env.BLOCK_MS, {
			fallback: 300,
			min: 0,
			max: 5000,
		}),
	};
	return config;
}
