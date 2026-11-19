import { randomUUID } from "node:crypto";
import { WebSocket, WebSocketServer } from "ws";
import { LatencyInjector } from "./latency.js";
import {
	CLOSE,
	decodeClientMessage,
	encodeMessage,
	PROTOCOL_VERSION,
	ProtocolError,
} from "./protocol.js";

function messageHint(data) {
	try {
		const value = JSON.parse(data.toString());
		return value?.type ?? null;
	} catch {
		return null;
	}
}

export function attachWebSocket(server, { config, rooms }) {
	const wss = new WebSocketServer({
		server,
		path: "/ws",
		maxPayload: config.maxPayloadBytes,
	});
	const clients = new Map();
	const stats = {
		droppedMessages: 0,
		closedSlowClients: 0,
		droppedPackets: 0,
		bytesIn: 0,
		bytesOut: 0,
		inputs: 0,
		snapshots: 0,
	};
	const latency = new LatencyInjector(config);

	wss.on("error", (error) => console.error("[ws]", error.message));

	function send(socket, message, { critical = false, delayed = false } = {}) {
		if (socket.readyState !== WebSocket.OPEN) return;
		if (socket.bufferedAmount > config.slowClientBufferBytes) {
			if (!critical) {
				stats.droppedMessages += 1;
				return;
			}
			if (socket.bufferedAmount > config.slowClientBufferBytes * 4) {
				stats.closedSlowClients += 1;
				socket.close(CLOSE.SLOW_CLIENT, "slow client");
				return;
			}
		}
		const payload = encodeMessage(message);
		stats.bytesOut += Buffer.byteLength(payload);
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

	function fail(socket, code, message) {
		send(socket, { type: "error", code, message }, { critical: true });
		if (socket.readyState === WebSocket.OPEN)
			socket.close(code, message.slice(0, 100));
	}

	function roomSockets(room) {
		return [...clients.entries()]
			.filter(([, state]) => state.room === room)
			.map(([socket]) => socket);
	}

	function broadcast(room, message, options = {}) {
		for (const socket of roomSockets(room)) send(socket, message, options);
	}

	function announceRoster(room) {
		broadcast(
			room,
			{ type: "roster", room: room.id, players: [...room.players.values()] },
			{ critical: true },
		);
	}

	function announceNetState() {
		for (const socket of clients.keys())
			send(
				socket,
				{ type: "netState", net: latency.settings },
				{ critical: true },
			);
	}

	function subscribeTicks(socket, state, room) {
		unsubscribeTicks(state);
		const match = room.match;
		if (!match) return;
		state.tickHandler = () => {
			const snapshot = match.snapshotFor(state.player?.id);
			if (!snapshot) return;
			stats.snapshots += 1;
			send(socket, snapshot, { delayed: true });
		};
		match.on("tick", state.tickHandler);
	}

	function unsubscribeTicks(state) {
		if (!state.tickHandler) return;
		state.room?.match?.off("tick", state.tickHandler);
		state.tickHandler = null;
	}

	function leaveRoom(state) {
		const { room, player } = state;
		unsubscribeTicks(state);
		state.room = null;
		state.player = null;
		if (!room || !player) return;
		room.leave(player.id);
		announceRoster(room);
	}

	function allowMessage(state, now) {
		const elapsed = now - state.lastRefill;
		state.tokens = Math.min(
			config.messagesPerSecond,
			state.tokens + (elapsed * config.messagesPerSecond) / 1000,
		);
		state.lastRefill = now;
		if (state.tokens < 1) return false;
		state.tokens -= 1;
		return true;
	}

	function onMessage(socket, state, data, isBinary) {
		try {
			if (!allowMessage(state, Date.now())) {
				fail(socket, CLOSE.RATE_LIMIT, "too many messages");
				return;
			}
			if (isBinary) {
				throw new ProtocolError(
					CLOSE.INVALID_MESSAGE,
					"binary frames are not supported",
				);
			}
			stats.bytesIn += Buffer.byteLength(data.toString());
			const message = decodeClientMessage(data, config);

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
				clearTimeout(state.joinTimer);
				state.joinTimer = null;
				state.room = room;
				state.player = player;
				send(
					socket,
					{
						type: "welcome",
						player,
						room: room.info(),
						protocol: PROTOCOL_VERSION,
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
				broadcast(state.room, { type: "chat", ...event }, { critical: true });
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
				fail(socket, error.code, error.message);
			else {
				console.error("[ws]", error.message);
				fail(socket, CLOSE.POLICY, "internal error");
			}
		}
	}

	wss.on("connection", (socket, request) => {
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

		const state = {
			room: null,
			player: null,
			tickHandler: null,
			tokens: config.messagesPerSecond,
			lastRefill: Date.now(),
			missedPongs: 0,
			isAlive: true,
			joinTimer: null,
		};
		clients.set(socket, state);

		socket.on("error", (error) => console.error("[ws socket]", error.message));
		socket.on("pong", () => {
			state.isAlive = true;
			state.missedPongs = 0;
		});
		socket.on("message", (data, isBinary) => {
			const hint = isBinary ? null : messageHint(data);
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
			leaveRoom(state);
			clients.delete(socket);
		});

		state.joinTimer = setTimeout(() => {
			if (!state.room && socket.readyState === WebSocket.OPEN) {
				socket.close(CLOSE.JOIN_TIMEOUT, "join timeout");
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
				codecs: ["json"],
			},
			{ critical: true },
		);
	});

	const heartbeat = setInterval(() => {
		for (const [socket, state] of clients) {
			if (socket.readyState !== WebSocket.OPEN) continue;
			if (!state.isAlive) state.missedPongs += 1;
			if (state.missedPongs >= config.maxMissedPongs) {
				socket.terminate();
				continue;
			}
			state.isAlive = false;
			socket.ping();
		}
	}, config.pingIntervalMs);
	heartbeat.unref();

	async function close() {
		clearInterval(heartbeat);
		for (const state of clients.values()) unsubscribeTicks(state);
		const stopped = new Promise((resolveClosed) => wss.close(resolveClosed));
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
