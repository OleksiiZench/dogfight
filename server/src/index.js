import { mkdir, readFile } from "node:fs/promises";
import { createServer } from "node:http";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { loadConfig } from "./config.js";
import { HttpError, handleApi, sendJson } from "./http/router.js";
import { serveStatic } from "./http/static.js";
import { attachMatchLog } from "./log/matchlog.js";
import { Match } from "./match.js";
import { RoomManager } from "./rooms.js";
import { attachWebSocket } from "./ws.js";

export async function createApp(config = loadConfig()) {
	await mkdir(config.logDir, { recursive: true });
	const definitions = JSON.parse(await readFile(config.roomsFile, "utf8"));
	const rooms = new RoomManager({
		definitions,
		maxRooms: config.maxRooms,
		maxPlayersPerRoom: config.maxPlayersPerRoom,
	});
	const sockets = new Set();
	const closeHooks = [];
	const startedAt = Date.now();
	let closing = null;

	const server = createServer((req, res) => {
		void handleRequest(req, res);
	});
	server.on("error", (error) => console.error("[http]", error.message));
	server.on("connection", (socket) => {
		sockets.add(socket);
		socket.on("close", () => sockets.delete(socket));
		socket.on("error", (error) => console.error("[socket]", error.message));
	});

	const logs = new Map();
	const matches = new Map();

	function attachLog(room) {
		const log = attachMatchLog(room, config);
		logs.set(room.id, log);
	}

	function attachMatch(room) {
		const match = new Match(room, { tickRate: config.tickRate });
		room.match = match;
		matches.set(room.id, match);
		match.start();
	}

	for (const room of rooms.rooms.values()) {
		attachLog(room);
		attachMatch(room);
	}
	rooms.on("created", (room) => {
		attachLog(room);
		attachMatch(room);
	});
	rooms.on("removed", (room) => {
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

	async function handleRequest(req, res) {
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
				error: error.message,
			});
		}
	}

	function listen() {
		return new Promise((resolveListen, rejectListen) => {
			const onError = (error) => {
				server.off("listening", onListening);
				rejectListen(error);
			};
			const onListening = () => {
				server.off("error", onError);
				resolveListen();
			};
			server.once("error", onError);
			server.once("listening", onListening);
			server.listen(config.port, config.host);
		});
	}

	async function close() {
		if (closing) return closing;
		closing = (async () => {
			for (const hook of closeHooks) {
				try {
					await hook();
				} catch (error) {
					console.error("[shutdown]", error.message);
				}
			}
			const stopped = new Promise((resolveClosed) =>
				server.close(resolveClosed),
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
	const shutdown = (signal) => {
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
