import { mkdir, readFile } from "node:fs/promises";
import type { IncomingMessage, ServerResponse } from "node:http";
import { createServer } from "node:http";
import type { Socket } from "node:net";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { setProfileEnabled } from "shared/profile.ts";
import type { ServerConfig } from "./config.ts";
import { loadConfig } from "./config.ts";
import { HttpError, handleApi, sendJson } from "./http/router.ts";
import { serveStatic } from "./http/static.ts";
import type { MatchLog } from "./log/matchlog.ts";
import { attachMatchLog } from "./log/matchlog.ts";
import { Match } from "./match.ts";
import type { Room } from "./rooms.ts";
import { RoomManager } from "./rooms.ts";
import { attachWebSocket } from "./ws.ts";

export async function createApp(config: ServerConfig = loadConfig()) {
	setProfileEnabled(process.env.PROFILE === "1");
	await mkdir(config.logDir, { recursive: true });
	const definitionsValue: unknown = JSON.parse(
		await readFile(config.roomsFile, "utf8"),
	);
	const definitions: readonly unknown[] = Array.isArray(definitionsValue)
		? definitionsValue
		: [];
	const rooms = new RoomManager({
		definitions,
		maxRooms: config.maxRooms,
		maxPlayersPerRoom: config.maxPlayersPerRoom,
	});
	const sockets = new Set<Socket>();
	const closeHooks: Array<() => void | Promise<void>> = [];
	const startedAt = Date.now();
	let closing: Promise<void> | null = null;

	const server = createServer((req, res) => {
		void handleRequest(req, res);
	});
	server.on("error", (error: Error) => console.error("[http]", error.message));
	server.on("connection", (socket: Socket) => {
		sockets.add(socket);
		socket.on("close", () => sockets.delete(socket));
		socket.on("error", (error: Error) =>
			console.error("[socket]", error.message),
		);
	});

	const logs = new Map<string, MatchLog>();
	const matches = new Map<string, Match>();

	function attachLog(room: Room): void {
		const log = attachMatchLog(room, config);
		logs.set(room.id, log);
	}

	function attachMatch(room: Room): void {
		const match = new Match(room, { tickRate: config.tickRate });
		room.match = match;
		matches.set(room.id, match);
		match.start();
	}

	for (const room of rooms.rooms.values()) {
		attachLog(room);
		attachMatch(room);
	}
	rooms.on("created", (room: Room) => {
		attachLog(room);
		attachMatch(room);
	});
	rooms.on("removed", (room: Room) => {
		const match = matches.get(room.id);
		if (match) {
			match.close();
			matches.delete(room.id);
		}
		const log = logs.get(room.id);
		if (!log) return;
		void log.close().finally(() => logs.delete(room.id));
	});
	closeHooks.push(async () => {
		for (const match of matches.values()) match.close();
		matches.clear();
	});
	closeHooks.push(async () => {
		await Promise.all([...logs.values()].map((log) => log.close()));
		logs.clear();
	});

	const gameServer = attachWebSocket(server, { config, rooms });
	closeHooks.push(() => gameServer.close());

	async function handleRequest(
		req: IncomingMessage,
		res: ServerResponse,
	): Promise<void> {
		if (closing) {
			sendJson(res, 503, { ok: false, error: "server is shutting down" });
			return;
		}
		const url = new URL(req.url ?? "/", "http://localhost");
		try {
			if (url.pathname === "/health" || url.pathname.startsWith("/api/")) {
				const handled = await handleApi(req, res, url, {
					config,
					rooms,
					startedAt,
					gameServer,
					matches,
					logCount: logs.size,
				});
				if (!handled) sendJson(res, 404, { error: "unknown endpoint" });
				return;
			}
			await serveStatic(req, res, config.clientDist);
		} catch (error) {
			if (res.headersSent || res.destroyed) return;
			sendJson(res, error instanceof HttpError ? error.status : 500, {
				error: error instanceof Error ? error.message : String(error),
			});
		}
	}

	function listen(): Promise<void> {
		return new Promise<void>((resolveListen, rejectListen) => {
			const onError = (error: Error): void => {
				server.off("listening", onListening);
				rejectListen(error);
			};
			const onListening = (): void => {
				server.off("error", onError);
				resolveListen();
			};
			server.once("error", onError);
			server.once("listening", onListening);
			server.listen(config.port, config.host);
		});
	}

	async function close(): Promise<void> {
		if (closing) return closing;
		closing = (async () => {
			for (const hook of closeHooks) {
				try {
					await hook();
				} catch (error) {
					console.error(
						"[shutdown]",
						error instanceof Error ? error.message : String(error),
					);
				}
			}
			const stopped = new Promise<void>((resolveClosed) =>
				server.close(() => resolveClosed()),
			);
			for (const socket of sockets) socket.destroy();
			await stopped;
		})();
		return closing;
	}

	return {
		config,
		rooms,
		matches,
		server,
		sockets,
		gameServer,
		closeHooks,
		listen,
		close,
	};
}

const isMain =
	process.argv[1] &&
	resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isMain) {
	const app = await createApp();
	let stopping = false;
	const shutdown = (signal: string): void => {
		if (stopping) return;
		stopping = true;
		console.log(`[server] ${signal}, shutting down`);
		void app.close().then(() => process.exit(0));
	};
	for (const signal of ["SIGINT", "SIGTERM"])
		process.once(signal, () => shutdown(signal));
	await app.listen();
	console.log(`[server] http://${app.config.host}:${app.config.port}`);
}
