import pino from "pino";
import type { ServerConfig } from "./config.ts";

export type Logger = pino.Logger;

export function createLogger(
	config: Pick<ServerConfig, "logLevel" | "version" | "nodeEnv">,
): Logger {
	return pino({
		level: process.env.VITEST ? "silent" : config.logLevel,
		base: { version: config.version, env: config.nodeEnv },
		timestamp: pino.stdTimeFunctions.isoTime,
		redact: {
			paths: [
				"password",
				"token",
				"secret",
				"authorization",
				"headers.authorization",
				"headers.cookie",
			],
			censor: "[redacted]",
		},
	});
}
