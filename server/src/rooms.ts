import { EventEmitter } from "node:events";
import type { RoomInfo } from "shared/protocol/schema.ts";
import type { Arena, GameEvent, PlayerId } from "shared/types.ts";
import type { Match } from "./match.ts";

export class RoomError extends Error {
	readonly status: number;

	constructor(status: number, message: string) {
		super(message);
		this.name = "RoomError";
		this.status = status;
	}
}

export interface RoomPlayer {
	id: PlayerId;
	name: string;
}

export interface RoomDefinition {
	id: string;
	name: string;
	seed: number;
	arena: Arena;
	asteroidTarget: number;
	capacity: number;
}

export interface RoomEventDetails {
	player?: RoomPlayer;
	text?: string;
	game?: GameEvent;
}

export interface RoomEventBase {
	t: string;
	seq: number;
	room: string;
}

export type RoomEvent<
	T extends string = string,
	D extends RoomEventDetails = RoomEventDetails,
> = RoomEventBase & { type: T } & D;

export type RoomChatEvent = RoomEvent<
	"chat",
	{ player: RoomPlayer; text: string }
>;

const isRecord = (value: unknown): value is Record<string, unknown> =>
	Boolean(value) && typeof value === "object" && !Array.isArray(value);

function identifier(value: unknown): string {
	const id = String(value ?? "").trim();
	if (!/^[a-z0-9][a-z0-9_-]{0,31}$/.test(id)) {
		throw new RoomError(400, "room id has to match [a-z0-9][a-z0-9_-]{0,31}");
	}
	return id;
}

function boundedNumber(
	value: unknown,
	name: string,
	min: number,
	max: number,
): number {
	const number = Number(value);
	if (!Number.isInteger(number) || number < min || number > max) {
		throw new RoomError(
			400,
			`${name} has to be an integer between ${min} and ${max}`,
		);
	}
	return number;
}

export function normalizeRoomDefinition(
	raw: unknown,
	maxPlayersPerRoom: number,
): RoomDefinition {
	if (!isRecord(raw)) {
		throw new RoomError(400, "room definition has to be an object");
	}
	const arena = isRecord(raw.arena) ? raw.arena : {};
	return {
		id: identifier(raw.id),
		name: String(raw.name ?? "")
			.trim()
			.slice(0, 80),
		seed: boundedNumber(raw.seed ?? 1, "seed", 0, 2 ** 31 - 1),
		arena: {
			width: boundedNumber(arena.width ?? 1200, "arena.width", 320, 4096),
			height: boundedNumber(arena.height ?? 700, "arena.height", 240, 4096),
		},
		asteroidTarget: boundedNumber(
			raw.asteroidTarget ?? 0,
			"asteroidTarget",
			0,
			50,
		),
		capacity: Math.min(
			boundedNumber(
				raw.capacity ?? maxPlayersPerRoom,
				"capacity",
				1,
				maxPlayersPerRoom,
			),
			maxPlayersPerRoom,
		),
	};
}

export class Room extends EventEmitter {
	readonly id: string;
	readonly name: string;
	readonly seed: number;
	readonly arena: Arena;
	readonly asteroidTarget: number;
	readonly capacity: number;
	readonly players: Map<PlayerId, RoomPlayer>;
	sequence: number;
	match: Match | null = null;

	constructor(definition: RoomDefinition) {
		super();
		this.id = definition.id;
		this.name = definition.name || definition.id;
		this.seed = definition.seed;
		this.arena = definition.arena;
		this.asteroidTarget = definition.asteroidTarget;
		this.capacity = definition.capacity;
		this.players = new Map();
		this.sequence = 0;
		this.on("error", (error: Error) =>
			console.error(`[room ${this.id}]`, error.message),
		);
	}

	get isEmpty(): boolean {
		return this.players.size === 0;
	}

	record<T extends string, D extends RoomEventDetails>(
		type: T,
		details: D,
	): RoomEvent<T, D>;
	record(type: string, details?: RoomEventDetails): RoomEvent;
	record(type: string, details: RoomEventDetails = {}): RoomEvent {
		const event: RoomEvent = {
			t: new Date().toISOString(),
			seq: ++this.sequence,
			type,
			room: this.id,
			...details,
		};
		this.emit("event", event);
		return event;
	}

	join(player: RoomPlayer | null | undefined): RoomPlayer {
		const id = String(player?.id ?? "").trim();
		const name = String(player?.name ?? "")
			.trim()
			.slice(0, 24);
		if (!id || !name)
			throw new RoomError(400, "player id and name are required");
		const existing = this.players.get(id);
		if (existing) return existing;
		if (this.players.size >= this.capacity)
			throw new RoomError(403, "room is full");
		const entry: RoomPlayer = { id, name };
		this.players.set(id, entry);
		this.record("join", { player: entry });
		this.emit("join", entry);
		return entry;
	}

	leave(id: string): RoomPlayer | null {
		const key = String(id);
		const player = this.players.get(key);
		if (!player) return null;
		this.players.delete(key);
		this.record("leave", { player });
		this.emit("leave", player);
		if (this.isEmpty) this.emit("empty");
		return player;
	}

	chat(id: string, text: unknown): RoomChatEvent {
		const player = this.players.get(String(id));
		if (!player) throw new RoomError(403, "join the room before chatting");
		const value = String(text ?? "").trim();
		if (!value) throw new RoomError(400, "chat text cannot be empty");
		const event = this.record("chat", { player, text: value.slice(0, 240) });
		this.emit("chat", event);
		return event;
	}

	info(): RoomInfo {
		return {
			id: this.id,
			name: this.name,
			seed: this.seed,
			arena: this.arena,
			asteroidTarget: this.asteroidTarget,
			capacity: this.capacity,
			players: this.players.size,
			playerNames: [...this.players.values()].map((player) => player.name),
		};
	}

	toJSON(): RoomInfo {
		return this.info();
	}
}

export interface RoomManagerOptions {
	definitions?: readonly unknown[];
	maxRooms?: number;
	maxPlayersPerRoom?: number;
}

export class RoomManager extends EventEmitter {
	readonly rooms: Map<string, Room>;
	readonly maxRooms: number;
	readonly maxPlayersPerRoom: number;

	constructor({
		definitions = [],
		maxRooms = 50,
		maxPlayersPerRoom = 8,
	}: RoomManagerOptions = {}) {
		super();
		this.rooms = new Map();
		this.maxRooms = maxRooms;
		this.maxPlayersPerRoom = maxPlayersPerRoom;
		this.on("error", (error: Error) => console.error("[rooms]", error.message));
		for (const definition of definitions) {
			try {
				this.create(definition);
			} catch (error) {
				this.emit("error", error);
			}
		}
	}

	list(): RoomInfo[] {
		return [...this.rooms.values()].map((room) => room.info());
	}

	get(id: string): Room | null {
		return this.rooms.get(String(id)) ?? null;
	}

	create(raw: unknown): Room {
		const definition = normalizeRoomDefinition(raw, this.maxPlayersPerRoom);
		if (this.rooms.has(definition.id)) {
			throw new RoomError(409, `room ${definition.id} already exists`);
		}
		if (this.rooms.size >= this.maxRooms) {
			throw new RoomError(413, "room limit reached");
		}
		const room = new Room(definition);
		room.on("empty", () => this.remove(room.id));
		this.rooms.set(room.id, room);
		this.emit("created", room);
		return room;
	}

	remove(id: string): boolean {
		const key = String(id);
		const room = this.rooms.get(key);
		if (!room) return false;
		this.rooms.delete(key);
		this.emit("removed", room);
		return true;
	}
}
