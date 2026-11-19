import { randomUUID } from "node:crypto";
import { WebSocket, WebSocketServer } from "ws";
import {
	CLOSE,
	decodeClientMessage,
	encodeMessage,
	PROTOCOL_VERSION,
	ProtocolError,
} from "./protocol.js";

export function attachWebSocket(server, { config, rooms }) {
	const wss = new WebSocketServer({
		server,
		path: "/ws",
		maxPayload: config.maxPayloadBytes,
	});
	const clients = new Map();
	const stats = { droppedMessages: 0, closedSlowClients: 0 };

	wss.on("error", (error) => console.error("[ws]", error.message));

	function send(socket, message, { critical = false } = {}) {
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
		socket.send(encodeMessage(message));
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

	function leaveRoom(state) {
		const { room, player } = state;
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
			const message = decodeClientMessage(data, config);

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
					},
					{ critical: true },
				);
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

	wss.on("connection", (socket) => {
		const state = {
			room: null,
			player: null,
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
		socket.on("message", (data, isBinary) =>
			onMessage(socket, state, data, isBinary),
		);
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

	return { wss, clients, stats, close };
}
