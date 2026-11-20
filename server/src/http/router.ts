import { stat } from "node:fs/promises";
import type { IncomingMessage, ServerResponse } from "node:http";
import { profileMeasures } from "shared/profile.ts";
import type { ServerConfig } from "../config.ts";
import { listReplays, replayPath, streamReplay } from "../log/replay.ts";
import type { Match } from "../match.ts";
import type { Metrics } from "../metrics.ts";
import type { RoomManager } from "../rooms.ts";
import type { GameServer } from "../ws.ts";

export class HttpError extends Error {
	readonly status: number;

	constructor(status: number, message: string) {
		super(message);
		this.name = "HttpError";
		this.status = status;
	}
}

function messageOf(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
	Boolean(value) && typeof value === "object" && !Array.isArray(value);

export function sendJson(
	res: ServerResponse,
	status: number,
	payload: unknown,
): void {
	const body = JSON.stringify(payload);
	res.writeHead(status, {
		"Content-Type": "application/json; charset=utf-8",
		"Content-Length": Buffer.byteLength(body),
		"Cache-Control": "no-store",
	});
	res.end(body);
}

export async function readJsonBody(
	req: AsyncIterable<Buffer>,
	maxBytes: number,
): Promise<Record<string, unknown>> {
	const chunks: Buffer[] = [];
	let size = 0;
	for await (const chunk of req) {
		size += chunk.length;
		if (size > maxBytes) throw new HttpError(413, "request body is too large");
		chunks.push(chunk);
	}
	if (size === 0) return {};
	try {
		const value: unknown = JSON.parse(Buffer.concat(chunks).toString("utf8"));
		if (!isRecord(value)) throw new Error("body has to be an object");
		return value;
	} catch (error) {
		throw new HttpError(400, `invalid JSON body: ${messageOf(error)}`);
	}
}

function methodNotAllowed(res: ServerResponse, allow: string): never {
	res.setHeader("Allow", allow);
	throw new HttpError(405, "method not allowed");
}

function busyWait(milliseconds: number): void {
	const until = Date.now() + milliseconds;
	while (Date.now() < until) {}
}

export interface ApiContext {
	config: ServerConfig;
	rooms: RoomManager;
	startedAt: number;
	gameServer?: GameServer;
	matches?: ReadonlyMap<string, Match>;
	logCount?: number;
	metrics: Metrics;
	ready: boolean;
}

export async function handleApi(
	req: IncomingMessage,
	res: ServerResponse,
	url: URL,
	context: ApiContext,
): Promise<boolean> {
	const {
		config,
		rooms,
		startedAt,
		gameServer,
		matches = new Map<string, Match>(),
		logCount = 0,
		metrics,
		ready,
	} = context;

	if (url.pathname === "/health") {
		if (req.method !== "GET") methodNotAllowed(res, "GET");
		sendJson(res, 200, {
			ok: true,
			ready,
			version: config.version,
			uptimeMs: Date.now() - startedAt,
			rss: process.memoryUsage().rss,
			rooms: rooms.rooms.size,
			wsClients: gameServer?.clients.size ?? 0,
			droppedMessages: gameServer?.stats.droppedMessages ?? 0,
			activeLogs: logCount,
		});
		return true;
	}

	if (url.pathname === "/ready") {
		if (req.method !== "GET") methodNotAllowed(res, "GET");
		sendJson(res, ready ? 200 : 503, {
			ready,
			version: config.version,
		});
		return true;
	}

	if (url.pathname === "/metrics") {
		if (req.method !== "GET") methodNotAllowed(res, "GET");
		let players = 0;
		for (const room of rooms.rooms.values()) players += room.players.size;
		metrics.setResources(
			rooms.rooms.size,
			players,
			gameServer?.clients.size ?? 0,
		);
		metrics.setTicks(
			[...matches.values()].map((match) => ({
				room: match.room.id,
				p99DurationMs: match.getStats().p99DurationMs,
			})),
		);
		res.writeHead(200, {
			"Content-Type": metrics.contentType,
			"Cache-Control": "no-store",
		});
		res.end(await metrics.text());
		return true;
	}

	if (url.pathname === "/api/stats") {
		if (req.method !== "GET") methodNotAllowed(res, "GET");
		sendJson(res, 200, {
			net: gameServer?.latency.settings ?? null,
			matches: [...matches.values()].map((match) => match.getStats()),
		});
		return true;
	}

	if (url.pathname === "/api/profile") {
		if (req.method !== "GET") methodNotAllowed(res, "GET");
		sendJson(res, 200, { measures: profileMeasures() });
		return true;
	}

	if (url.pathname === "/api/slow") {
		if (req.method !== "GET") methodNotAllowed(res, "GET");
		busyWait(config.blockMs);
		sendJson(res, 200, { ok: true, blockedMs: config.blockMs });
		return true;
	}

	if (url.pathname === "/api/rooms") {
		if (req.method === "GET") {
			sendJson(res, 200, rooms.list());
			return true;
		}
		if (req.method === "POST") {
			const body = await readJsonBody(req, config.bodyMaxBytes);
			const room = rooms.create(body);
			sendJson(res, 201, room.info());
			return true;
		}
		methodNotAllowed(res, "GET, POST");
	}

	const botsRoute = /^\/api\/rooms\/([^/]+)\/bots$/.exec(url.pathname);
	if (botsRoute) {
		const roomId = decodeURIComponent(botsRoute[1] ?? "");
		const room = rooms.get(roomId);
		if (!room) throw new HttpError(404, "room not found");
		const match = matches.get(roomId);
		if (!match) throw new HttpError(404, "match not found");
		if (req.method === "GET") {
			sendJson(res, 200, { room: roomId, bots: match.bots.length });
			return true;
		}
		if (req.method === "POST") {
			const body = await readJsonBody(req, config.bodyMaxBytes);
			const raw = body.count ?? body.bots ?? 0;
			const count = Number(raw);
			if (!Number.isInteger(count) || count < 0 || count > match.maxBots) {
				throw new HttpError(
					400,
					`count has to be an integer between 0 and ${match.maxBots}`,
				);
			}
			sendJson(res, 200, { room: roomId, bots: match.setBots(count) });
			return true;
		}
		if (req.method === "DELETE") {
			sendJson(res, 200, { room: roomId, bots: match.setBots(0) });
			return true;
		}
		methodNotAllowed(res, "GET, POST, DELETE");
	}

	if (url.pathname === "/api/replays") {
		if (req.method !== "GET") methodNotAllowed(res, "GET");
		sendJson(res, 200, await listReplays(config.logDir));
		return true;
	}

	if (url.pathname.startsWith("/api/replays/")) {
		if (req.method !== "GET" && req.method !== "HEAD")
			methodNotAllowed(res, "GET, HEAD");
		const id = decodeURIComponent(url.pathname.slice("/api/replays/".length));
		const filePath = replayPath(config.logDir, id);
		try {
			await stat(filePath);
		} catch {
			throw new HttpError(404, "replay not found");
		}
		await streamReplay(res, filePath, { head: req.method === "HEAD" });
		return true;
	}

	return false;
}
