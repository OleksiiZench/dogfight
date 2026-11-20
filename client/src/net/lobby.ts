import type { ServerMessage } from "shared/protocol.ts";
import type { Arena } from "shared/types.ts";
import { fetchJson, isCancellation } from "../assets/loader.ts";
import { detailOf, dispatch } from "../events/bus.ts";
import type { Connection } from "./connection.ts";

const isRecord = (value: unknown): value is Record<string, unknown> =>
	typeof value === "object" && value !== null && !Array.isArray(value);

export interface LobbyRoom {
	id: string;
	name: string;
	seed?: number;
	arena?: Arena;
	asteroidTarget?: number;
	capacity?: number;
	players?: number;
	playerNames?: string[];
}

function parseRoom(value: unknown): LobbyRoom | null {
	if (
		!isRecord(value) ||
		typeof value.id !== "string" ||
		typeof value.name !== "string"
	)
		return null;
	const room: LobbyRoom = { id: value.id, name: value.name };
	if (typeof value.seed === "number") room.seed = value.seed;
	if (typeof value.asteroidTarget === "number")
		room.asteroidTarget = value.asteroidTarget;
	if (typeof value.capacity === "number") room.capacity = value.capacity;
	if (typeof value.players === "number") room.players = value.players;
	if (
		Array.isArray(value.playerNames) &&
		value.playerNames.every((name): name is string => typeof name === "string")
	) {
		room.playerNames = value.playerNames;
	}
	if (
		isRecord(value.arena) &&
		typeof value.arena.width === "number" &&
		typeof value.arena.height === "number"
	) {
		room.arena = { width: value.arena.width, height: value.arena.height };
	}
	return room;
}

export interface JoinedInfo {
	room: LobbyRoom;
	name: string;
	player?: { id: string; name: string };
}

export type ConnectionState =
	| "connected"
	| "connecting"
	| "reconnecting"
	| "closed"
	| "error";

export interface ConnectionStateDetail {
	state: ConnectionState;
	attempt?: number;
	delay?: number;
	code?: number;
	reason?: string;
	wasClean?: boolean;
}

export interface NoticeDetail {
	message?: string;
	reason?: string;
}

export interface LobbyOptions {
	url?: string;
	pollMs?: number;
	timeoutMs?: number;
	connection?: Connection | null;
}

export class Lobby extends EventTarget {
	#rooms: LobbyRoom[] = [];
	#controller: AbortController | null = null;
	#timer: ReturnType<typeof setInterval> | 0 = 0;
	#joined: JoinedInfo | null = null;
	#listeners: Array<[EventTarget, string, EventListener]> = [];
	url: string;
	pollMs: number;
	timeoutMs: number;
	connection: Connection | null;

	constructor({
		url = "/api/rooms",
		pollMs = 4000,
		timeoutMs = 6000,
		connection = null,
	}: LobbyOptions = {}) {
		super();
		this.url = url;
		this.pollMs = pollMs;
		this.timeoutMs = timeoutMs;
		this.connection = connection;
		if (connection) this.#bindConnection();
	}

	get rooms(): LobbyRoom[] {
		return [...this.#rooms];
	}

	get joined(): JoinedInfo | null {
		return this.#joined ? { ...this.#joined } : null;
	}

	#on(target: EventTarget, type: string, handler: EventListener): void {
		target.addEventListener(type, handler);
		this.#listeners.push([target, type, handler]);
	}

	#bindConnection(): void {
		const connection = this.connection;
		if (!connection) return;
		this.#on(connection, "open", () =>
			dispatch(this, "connectionState", { state: "connected" }),
		);
		this.#on(connection, "connecting", (event) => {
			const detail = detailOf<{ attempt: number }>(event);
			dispatch(this, "connectionState", {
				state: "connecting",
				attempt: detail.attempt,
			});
		});
		this.#on(connection, "reconnecting", (event) => {
			const detail = detailOf<{ attempt: number; delay: number }>(event);
			dispatch(this, "connectionState", {
				state: "reconnecting",
				...detail,
			});
		});
		this.#on(connection, "closed", (event) => {
			const detail = detailOf<{
				code: number;
				reason: string;
				wasClean: boolean;
			}>(event);
			dispatch(this, "connectionState", { state: "closed", ...detail });
		});
		this.#on(connection, "welcome", (event) => {
			const detail =
				detailOf<Extract<ServerMessage, { type: "welcome" }>>(event);
			const known = this.#rooms.find((room) => room.id === detail.room?.id);
			this.#joined = {
				room: { ...(known ?? {}), ...detail.room },
				name: detail.player.name,
				player: detail.player,
			};
			dispatch(this, "joined", this.joined);
		});
		this.#on(connection, "roster", (event) =>
			dispatch(this, "roster", detailOf<unknown>(event)),
		);
		this.#on(connection, "chat", (event) =>
			dispatch(this, "chat", detailOf<unknown>(event)),
		);
		this.#on(connection, "notice", (event) =>
			dispatch(this, "notice", detailOf<unknown>(event)),
		);
		this.#on(connection, "error", () =>
			dispatch(this, "connectionState", { state: "error" }),
		);
	}

	async refresh(): Promise<LobbyRoom[]> {
		if (!this.#controller) this.#controller = new AbortController();
		const controller = this.#controller;
		const signal = AbortSignal.any([
			controller.signal,
			AbortSignal.timeout(this.timeoutMs),
		]);
		dispatch(this, "refreshing");

		try {
			const rooms: unknown = await fetchJson(this.url, { signal });
			this.#rooms = Array.isArray(rooms)
				? rooms
						.map(parseRoom)
						.filter((room): room is LobbyRoom => room !== null)
				: [];
			dispatch(this, "roomsChanged", { rooms: this.rooms });
			return this.rooms;
		} catch (error) {
			if (!isCancellation(error)) dispatch(this, "requestFailed", { error });
			throw error;
		}
	}

	start(): void {
		this.connection?.connect();
		this.#controller = new AbortController();
		void this.refresh().catch(() => {});
		this.#timer = setInterval(() => {
			void this.refresh().catch(() => {});
		}, this.pollMs);
	}

	join(roomId: string, meta: { name?: string } = {}): boolean {
		const room = this.#rooms.find((entry) => entry.id === roomId);
		if (!room) return false;
		const name = meta.name?.trim() || "PILOT";
		dispatch(this, "joining", { room, name });
		this.connection?.join(room.id, name);
		if (!this.connection) {
			this.#joined = { room, name };
			dispatch(this, "joined", this.joined);
		}
		return true;
	}

	requestStart(): void {
		if (this.#joined) dispatch(this, "start", this.joined);
	}

	chat(text: string): void {
		this.connection?.chat(text);
	}

	leave(): void {
		clearInterval(this.#timer);
		this.#controller?.abort();
		this.#controller = null;
		this.connection?.leave();
		this.#joined = null;
		dispatch(this, "left");
	}

	detach(): void {
		for (const [target, type, handler] of this.#listeners) {
			target.removeEventListener(type, handler);
		}
		this.#listeners = [];
	}

	destroy(): void {
		this.leave();
		this.detach();
	}
}
