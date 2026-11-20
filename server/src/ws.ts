import { randomUUID } from "node:crypto";
import type { IncomingMessage, Server } from "node:http";
import type { ClientMessage, ServerMessage } from "shared/protocol.ts";
import type { BinarySource, CodecName } from "shared/types.ts";
import type { RawData } from "ws";
import { WebSocket, WebSocketServer } from "ws";
import type { ServerConfig } from "./config.ts";
import { LatencyInjector } from "./latency.ts";
import type { Logger } from "./logger.ts";
import {
	emptyRejectionCounts,
	type Metrics,
	type RejectionReason,
} from "./metrics.ts";
import { createRateLimiter, heartbeat } from "./policy.ts";
import {
	CLOSE,
	decodeBinaryClientMessage,
	decodeClientMessage,
	encodeMessage,
	PROTOCOL_VERSION,
	ProtocolError,
} from "./protocol.ts";
import type { Room, RoomManager, RoomPlayer } from "./rooms.ts";

const isRecord = (value: unknown): value is Record<string, unknown> =>
	Boolean(value) && typeof value === "object" && !Array.isArray(value);

function messageHint(data: RawData): string | null {
	try {
		const value: unknown = JSON.parse(data.toString());
		if (isRecord(value) && typeof value.type === "string") return value.type;
		return null;
	} catch {
		return null;
	}
}

function toBinarySource(data: RawData): BinarySource | null {
	if (data instanceof ArrayBuffer) return data;
	if (Array.isArray(data)) return Buffer.concat(data);
	if (ArrayBuffer.isView(data)) return data;
	return null;
}

function byteLengthOf(data: RawData): number {
	if (typeof data === "string") return Buffer.byteLength(data);
	if (Array.isArray(data))
		return data.reduce((total, chunk) => total + chunk.byteLength, 0);
	return data.byteLength;
}

function clientIp(request: IncomingMessage): string {
	const proxyIp =
		request.headers["fly-client-ip"] ?? request.headers["x-forwarded-for"];
	const value = Array.isArray(proxyIp) ? proxyIp[0] : proxyIp;
	return (
		value?.split(",")[0]?.trim() || request.socket.remoteAddress || "unknown"
	);
}

function rejectionOf(error: unknown): RejectionReason {
	if (error instanceof ProtocolError) {
		if (error.code === CLOSE.RATE_LIMIT) return "rate_limit";
		if (error.code === CLOSE.JOIN_TIMEOUT) return "join_timeout";
		if (error.code === CLOSE.SLOW_CLIENT) return "slow_client";
		if (error.code === CLOSE.OVERSIZE || error.code === CLOSE.INVALID_MESSAGE)
			return "payload";
	}
	return "policy";
}

export interface ClientState {
	room: Room | null;
	player: RoomPlayer | null;
	codec: CodecName;
	tickHandler: (() => void) | null;
	tokens: number;
	lastRefill: number;
	missedPongs: number;
	isAlive: boolean;
	joinTimer: NodeJS.Timeout | null;
}

export interface WsStats {
	droppedMessages: number;
	closedSlowClients: number;
	droppedPackets: number;
	messagesIn: number;
	messagesOut: number;
	bytesIn: number;
	bytesOut: number;
	inputs: number;
	snapshots: number;
	rejections: Record<RejectionReason, number>;
}

export interface SendOptions {
	critical?: boolean;
	delayed?: boolean;
	codec?: CodecName;
}

export interface GameServer {
	wss: WebSocketServer;
	clients: Map<WebSocket, ClientState>;
	stats: WsStats;
	latency: LatencyInjector;
	close(): Promise<void>;
}

export interface AttachWebSocketOptions {
	config: ServerConfig;
	rooms: RoomManager;
	logger: Logger;
	metrics: Metrics;
}

export function attachWebSocket(
	server: Server,
	{ config, rooms, logger, metrics }: AttachWebSocketOptions,
): GameServer {
	const rateLimiter = createRateLimiter(config.messagesPerSecond);
	const clients = new Map<WebSocket, ClientState>();
	const connectionsByIp = new Map<string, number>();
	const stats: WsStats = {
		droppedMessages: 0,
		closedSlowClients: 0,
		droppedPackets: 0,
		messagesIn: 0,
		messagesOut: 0,
		bytesIn: 0,
		bytesOut: 0,
		inputs: 0,
		snapshots: 0,
		rejections: emptyRejectionCounts(),
	};
	const latency = new LatencyInjector(config);

	function registerRejection(reason: RejectionReason): void {
		stats.rejections[reason] += 1;
		metrics.incRejection(reason);
	}

	function isOriginAllowed(origin: string | undefined): boolean {
		if (config.allowedOrigins.includes("*")) return true;
		if (!origin) return config.nodeEnv !== "production";
		return config.allowedOrigins.includes(origin);
	}

	const wss = new WebSocketServer({
		server,
		path: "/ws",
		maxPayload: config.maxPayloadBytes,
		verifyClient(info, done) {
			const origin = info.req.headers.origin;
			const ip = clientIp(info.req);
			if (!isOriginAllowed(origin)) {
				registerRejection("origin");
				logger.warn({ event: "ws.rejected", reason: "origin", origin, ip });
				done(false, 403, "origin not allowed");
				return;
			}
			if ((connectionsByIp.get(ip) ?? 0) >= config.maxConnectionsPerIp) {
				registerRejection("ip_limit");
				logger.warn({ event: "ws.rejected", reason: "ip_limit", ip });
				done(false, 429, "too many connections");
				return;
			}
			done(true);
		},
	});

	wss.on("error", (error: Error) =>
		logger.error({ event: "ws.error", err: error }, error.message),
	);

	function send(
		socket: WebSocket,
		message: ServerMessage,
		{ critical = false, delayed = false, codec = "json" }: SendOptions = {},
	): void {
		if (socket.readyState !== WebSocket.OPEN) return;
		if (socket.bufferedAmount > config.slowClientBufferBytes) {
			if (!critical) {
				stats.droppedMessages += 1;
				return;
			}
			if (socket.bufferedAmount > config.slowClientBufferBytes * 4) {
				stats.closedSlowClients += 1;
				registerRejection("slow_client");
				socket.close(CLOSE.SLOW_CLIENT, "slow client");
				return;
			}
		}
		const payload = encodeMessage(message, codec);
		const size =
			typeof payload === "string"
				? Buffer.byteLength(payload)
				: payload.byteLength;
		stats.messagesOut += 1;
		stats.bytesOut += size;
		metrics.incMessages("out");
		metrics.addBytes("out", size);
		if (!delayed) {
			socket.send(payload);
			return;
		}
		if (latency.shouldDrop()) {
			stats.droppedPackets += 1;
			return;
		}
		void latency.delay().then(() => {
			if (socket.readyState !== WebSocket.OPEN) {
				stats.droppedPackets += 1;
				return;
			}
			socket.send(payload);
		});
	}

	function fail(
		socket: WebSocket,
		code: number,
		message: string,
		reason: RejectionReason = "policy",
	): void {
		registerRejection(reason);
		logger.warn({ event: "ws.rejected", reason, code, message });
		send(socket, { type: "error", code, message }, { critical: true });
		if (socket.readyState === WebSocket.OPEN)
			socket.close(code, message.slice(0, 100));
	}

	function roomSockets(room: Room): WebSocket[] {
		return [...clients.entries()]
			.filter(([, state]) => state.room === room)
			.map(([socket]) => socket);
	}

	function broadcast(
		room: Room,
		message: ServerMessage,
		options: SendOptions = {},
	): void {
		for (const socket of roomSockets(room)) send(socket, message, options);
	}

	function announceRoster(room: Room): void {
		broadcast(
			room,
			{ type: "roster", room: room.id, players: [...room.players.values()] },
			{ critical: true },
		);
	}

	function announceNetState(): void {
		for (const socket of clients.keys())
			send(
				socket,
				{ type: "netState", net: latency.settings },
				{ critical: true },
			);
	}

	function subscribeTicks(
		socket: WebSocket,
		state: ClientState,
		room: Room,
	): void {
		unsubscribeTicks(state);
		const match = room.match;
		if (!match) return;
		state.tickHandler = () => {
			const snapshot = match.snapshotFor(state.player?.id ?? "");
			if (!snapshot) return;
			stats.snapshots += 1;
			send(socket, snapshot, { delayed: true, codec: state.codec });
		};
		match.on("tick", state.tickHandler);
	}

	function unsubscribeTicks(state: ClientState): void {
		if (!state.tickHandler) return;
		state.room?.match?.off("tick", state.tickHandler);
		state.tickHandler = null;
	}

	function leaveRoom(state: ClientState): void {
		const { room, player } = state;
		unsubscribeTicks(state);
		state.room = null;
		state.player = null;
		if (!room || !player) return;
		room.leave(player.id);
		logger.info(
			{ event: "player.left", roomId: room.id, playerId: player.id },
			"player left",
		);
		announceRoster(room);
	}

	function allowMessage(state: ClientState, now: number): boolean {
		return rateLimiter.allow(state, now);
	}

	function onMessage(
		socket: WebSocket,
		state: ClientState,
		data: RawData,
		isBinary: boolean,
	): void {
		try {
			if (!allowMessage(state, Date.now())) {
				fail(socket, CLOSE.RATE_LIMIT, "too many messages", "rate_limit");
				return;
			}
			const size = byteLengthOf(data);
			stats.messagesIn += 1;
			stats.bytesIn += size;
			metrics.incMessages("in");
			metrics.addBytes("in", size);

			let message: ClientMessage;
			if (isBinary) {
				const source = toBinarySource(data);
				if (!source) throw new Error("binary message has to be binary data");
				message = decodeBinaryClientMessage(source, config);
			} else {
				message = decodeClientMessage(data, config);
			}

			if (message.type === "ping") {
				send(
					socket,
					{ type: "pong", t: message.t, serverTime: Date.now() },
					{ delayed: true },
				);
				return;
			}

			if (message.type === "net") {
				latency.configure(message);
				announceNetState();
				return;
			}

			if (message.type === "input") {
				if (!state.room || !state.player) {
					throw new ProtocolError(
						CLOSE.NOT_JOINED,
						"join a room before sending inputs",
					);
				}
				state.room.match?.applyInput(state.player.id, message);
				stats.inputs += 1;
				return;
			}

			if (message.type === "join") {
				if (state.room) {
					throw new ProtocolError(CLOSE.POLICY, "leave the current room first");
				}
				const room = rooms.get(message.room);
				if (!room) {
					throw new ProtocolError(
						CLOSE.UNKNOWN_ROOM,
						`unknown room: ${message.room}`,
					);
				}
				const player = room.join({ id: randomUUID(), name: message.name });
				if (state.joinTimer) clearTimeout(state.joinTimer);
				state.joinTimer = null;
				state.room = room;
				state.player = player;
				state.codec = message.codec;
				logger.info(
					{
						event: "player.joined",
						roomId: room.id,
						playerId: player.id,
						name: player.name,
					},
					"player joined",
				);
				send(
					socket,
					{
						type: "welcome",
						player,
						room: room.info(),
						protocol: PROTOCOL_VERSION,
						codec: state.codec,
						tickRate: config.tickRate,
						net: latency.settings,
						lastProcessedSeq: 0,
					},
					{ critical: true },
				);
				subscribeTicks(socket, state, room);
				announceRoster(room);
				return;
			}

			if (message.type === "chat") {
				if (!state.room || !state.player) {
					throw new ProtocolError(
						CLOSE.NOT_JOINED,
						"join a room before chatting",
					);
				}
				const event = state.room.chat(state.player.id, message.text);
				const chatMessage: ServerMessage = { ...event };
				broadcast(state.room, chatMessage, { critical: true });
				return;
			}

			if (message.type === "leave") {
				leaveRoom(state);
				send(socket, { type: "left" }, { critical: true });
				send(
					socket,
					{ type: "roster", room: null, players: [] },
					{ critical: true },
				);
			}
		} catch (error) {
			if (error instanceof ProtocolError)
				fail(socket, error.code, error.message, rejectionOf(error));
			else {
				logger.error(
					{ event: "ws.message_error", err: error },
					"invalid client message",
				);
				fail(socket, CLOSE.POLICY, "internal error");
			}
		}
	}

	wss.on("connection", (socket: WebSocket, request: IncomingMessage) => {
		const ip = clientIp(request);
		connectionsByIp.set(ip, (connectionsByIp.get(ip) ?? 0) + 1);
		logger.info({ event: "ws.connected", ip }, "websocket connected");
		const url = new URL(request.url ?? "/", "http://localhost");
		const hasNetParams = ["latency", "jitter", "drop"].some((key) =>
			url.searchParams.has(key),
		);
		if (hasNetParams) {
			latency.configure({
				latencyMs: Number(url.searchParams.get("latency") ?? config.latencyMs),
				jitterMs: Number(url.searchParams.get("jitter") ?? config.jitterMs),
				dropRate: Number(url.searchParams.get("drop") ?? config.dropRate),
			});
		}

		const state: ClientState = {
			room: null,
			player: null,
			codec: "json",
			tickHandler: null,
			...rateLimiter.initial(Date.now()),
			missedPongs: 0,
			isAlive: true,
			joinTimer: null,
		};
		clients.set(socket, state);

		socket.on("error", (error: Error) =>
			logger.warn({ event: "ws.socket_error", ip, err: error }, error.message),
		);
		socket.on("pong", () => {
			state.isAlive = true;
			state.missedPongs = 0;
		});
		socket.on("message", (data: RawData, isBinary: boolean) => {
			const hint = isBinary ? "input" : messageHint(data);
			if (hint === "input" && latency.shouldDrop()) {
				stats.droppedPackets += 1;
				return;
			}
			if (hint === "join" || hint === "net") {
				onMessage(socket, state, data, isBinary);
				return;
			}
			void latency.delay().then(() => onMessage(socket, state, data, isBinary));
		});
		socket.on("close", () => {
			if (state.joinTimer) clearTimeout(state.joinTimer);
			const remaining = (connectionsByIp.get(ip) ?? 1) - 1;
			if (remaining > 0) connectionsByIp.set(ip, remaining);
			else connectionsByIp.delete(ip);
			leaveRoom(state);
			clients.delete(socket);
		});

		state.joinTimer = setTimeout(() => {
			if (!state.room && socket.readyState === WebSocket.OPEN) {
				fail(socket, CLOSE.JOIN_TIMEOUT, "join timeout", "join_timeout");
			}
		}, config.joinTimeoutMs);

		send(
			socket,
			{
				type: "hello",
				protocol: PROTOCOL_VERSION,
				joinTimeoutMs: config.joinTimeoutMs,
				tickRate: config.tickRate,
				net: latency.settings,
				codecs: ["json", "binary"],
			},
			{ critical: true },
		);
	});

	const heartbeatTimer = setInterval(() => {
		for (const [socket, state] of clients) {
			if (socket.readyState !== WebSocket.OPEN) continue;
			const result = heartbeat(state, config.maxMissedPongs);
			state.missedPongs = result.missedPongs;
			state.isAlive = result.isAlive;
			if (result.action === "terminate") {
				socket.terminate();
				continue;
			}
			socket.ping();
		}
	}, config.pingIntervalMs);
	heartbeatTimer.unref();

	async function close(): Promise<void> {
		clearInterval(heartbeatTimer);
		for (const state of clients.values()) unsubscribeTicks(state);
		for (const socket of clients.keys()) {
			send(
				socket,
				{ type: "shutdown", reason: "server shutdown" },
				{ critical: true },
			);
		}
		const stopped = new Promise<void>((resolveClosed) =>
			wss.close(() => resolveClosed()),
		);
		for (const [socket, state] of clients) {
			if (state.joinTimer) clearTimeout(state.joinTimer);
			if (socket.readyState === WebSocket.OPEN) {
				socket.close(CLOSE.SHUTDOWN, "server shutdown");
			}
		}
		setTimeout(() => {
			for (const socket of clients.keys()) socket.terminate();
		}, 250).unref();
		await stopped;
	}

	return { wss, clients, stats, latency, close };
}
