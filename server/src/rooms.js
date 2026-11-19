import { EventEmitter } from "node:events";

export class RoomError extends Error {
	constructor(status, message) {
		super(message);
		this.name = "RoomError";
		this.status = status;
	}
}

function identifier(value) {
	const id = String(value ?? "").trim();
	if (!/^[a-z0-9][a-z0-9_-]{0,31}$/.test(id)) {
		throw new RoomError(400, "room id has to match [a-z0-9][a-z0-9_-]{0,31}");
	}
	return id;
}

function boundedNumber(value, name, min, max) {
	const number = Number(value);
	if (!Number.isInteger(number) || number < min || number > max) {
		throw new RoomError(
			400,
			`${name} has to be an integer between ${min} and ${max}`,
		);
	}
	return number;
}

export function normalizeRoomDefinition(raw, maxPlayersPerRoom) {
	if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
		throw new RoomError(400, "room definition has to be an object");
	}
	const arena = raw.arena ?? {};
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
	constructor(definition) {
		super();
		this.id = definition.id;
		this.name = definition.name || definition.id;
		this.seed = definition.seed;
		this.arena = definition.arena;
		this.asteroidTarget = definition.asteroidTarget;
		this.capacity = definition.capacity;
		this.players = new Map();
		this.sequence = 0;
		this.on("error", (error) =>
			console.error(`[room ${this.id}]`, error.message),
		);
	}

	get isEmpty() {
		return this.players.size === 0;
	}

	record(type, details = {}) {
		const event = {
			t: new Date().toISOString(),
			seq: ++this.sequence,
			type,
			room: this.id,
			...details,
		};
		this.emit("event", event);
		return event;
	}

	join(player) {
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
		const entry = { id, name };
		this.players.set(id, entry);
		this.record("join", { player: entry });
		this.emit("join", entry);
		return entry;
	}

	leave(id) {
		const player = this.players.get(String(id));
		if (!player) return null;
		this.players.delete(String(id));
		this.record("leave", { player });
		this.emit("leave", player);
		if (this.isEmpty) this.emit("empty");
		return player;
	}

	chat(id, text) {
		const player = this.players.get(String(id));
		if (!player) throw new RoomError(403, "join the room before chatting");
		const value = String(text ?? "").trim();
		if (!value) throw new RoomError(400, "chat text cannot be empty");
		const event = this.record("chat", { player, text: value.slice(0, 240) });
		this.emit("chat", event);
		return event;
	}

	info() {
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

	toJSON() {
		return this.info();
	}
}

export class RoomManager extends EventEmitter {
	constructor({ definitions = [], maxRooms = 50, maxPlayersPerRoom = 8 } = {}) {
		super();
		this.rooms = new Map();
		this.maxRooms = maxRooms;
		this.maxPlayersPerRoom = maxPlayersPerRoom;
		this.on("error", (error) => console.error("[rooms]", error.message));
		for (const definition of definitions) {
			try {
				this.create(definition);
			} catch (error) {
				this.emit("error", error);
			}
		}
	}

	list() {
		return [...this.rooms.values()].map((room) => room.info());
	}

	get(id) {
		return this.rooms.get(String(id)) ?? null;
	}

	create(raw) {
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

	remove(id) {
		const room = this.rooms.get(String(id));
		if (!room) return false;
		this.rooms.delete(String(id));
		this.emit("removed", room);
		return true;
	}
}
