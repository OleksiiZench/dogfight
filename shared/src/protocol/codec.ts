/*
 * Binary protocol v1 (little-endian, DataView):
 * byte 0: version = 1
 * byte 1: message type (1 = input, 2 = snapshot)
 * Input: seq u32, tick u32, turn i16 (radians * 1000), thrust u8, fire u8 = 13 bytes.
 * Snapshot: tick u32, arena width/height f32, player count u16,
 *   per player: id/name/color strings (u8 length + UTF-8), score i32, shipId i32 (-1 = none), respawnIn i16 ms (-1 = none),
 *   entity count u16,
 *   per entity: id u16, kind u8 (1 ship, 2 bullet, 3 asteroid, 4 pickup, 5 explosion), x/y/vx/vy f32,
 *     angle i16 (radians * 1000), age u16 (centiseconds), radius f32, behavior count u8 (name string, remaining i16 ms),
 *     kind payload: ship(playerId, color, hp u8, maxHp u8, fireDelay u16 ms, cooldown u16 ms, thrusting u8),
 *       bullet(ownerId, sourceSeq u32, ttl u16 ms, damage u8),
 *       asteroid(hp u8, spin i16, shape count u8 + values u8 each * 100),
 *       pickup(effect, ttl u16 ms),
 *       explosion(color, life u16 ms, particle count u8 + x/y/vx/vy f32 + ttl u16 ms),
 *   events length u16 + UTF-8 JSON, lastProcessedSeq u32.
 * Strings are truncated to 255 bytes; timestamps are milliseconds unless noted.
 */

export const CODEC_VERSION = 1;
export const MESSAGE_TYPE = { INPUT: 1, SNAPSHOT: 2 };

const encoder = new TextEncoder();
const decoder = new TextDecoder();
const KINDS = { ship: 1, bullet: 2, asteroid: 3, pickup: 4, explosion: 5 };
const KIND_NAMES = Object.fromEntries(
	Object.entries(KINDS).map(([name, code]) => [code, name]),
);

function clamp(value, min, max) {
	return Math.min(max, Math.max(min, Number(value) || 0));
}

function integer(value, min, max) {
	return Math.round(clamp(value, min, max));
}

function ms(value) {
	return integer((Number(value) || 0) * 1000, 0, 65535);
}

function centiseconds(value) {
	return integer((Number(value) || 0) * 100, 0, 65535);
}

function signedMs(value) {
	if (value === null || value === undefined) return -1;
	return integer(Number(value) * 1000, -32768, 32767);
}

function radians(value) {
	return integer((Number(value) || 0) * 1000, -32768, 32767);
}

function bytesOf(data) {
	return data instanceof Uint8Array ? data : new Uint8Array(data);
}

function toArrayBuffer(data) {
	if (data instanceof ArrayBuffer) return data;
	const bytes = bytesOf(data);
	return bytes.buffer.slice(
		bytes.byteOffset,
		bytes.byteOffset + bytes.byteLength,
	);
}

class Writer {
	constructor(size = 512) {
		this.buffer = new ArrayBuffer(size);
		this.view = new DataView(this.buffer);
		this.offset = 0;
	}

	ensure(length) {
		const needed = this.offset + length;
		if (needed <= this.buffer.byteLength) return;
		let size = this.buffer.byteLength * 2;
		while (size < needed) size *= 2;
		const next = new ArrayBuffer(size);
		new Uint8Array(next).set(new Uint8Array(this.buffer));
		this.buffer = next;
		this.view = new DataView(next);
	}

	u8(value) {
		this.ensure(1);
		this.view.setUint8(this.offset++, value);
		return this;
	}

	i16(value) {
		this.ensure(2);
		this.view.setInt16(this.offset, value, true);
		this.offset += 2;
		return this;
	}

	u16(value) {
		this.ensure(2);
		this.view.setUint16(this.offset, value, true);
		this.offset += 2;
		return this;
	}

	i32(value) {
		this.ensure(4);
		this.view.setInt32(this.offset, value, true);
		this.offset += 4;
		return this;
	}

	u32(value) {
		this.ensure(4);
		this.view.setUint32(this.offset, value, true);
		this.offset += 4;
		return this;
	}

	f32(value) {
		this.ensure(4);
		this.view.setFloat32(this.offset, value, true);
		this.offset += 4;
		return this;
	}

	bytes(data) {
		const bytes = bytesOf(data);
		this.ensure(bytes.byteLength);
		new Uint8Array(this.buffer, this.offset).set(bytes);
		this.offset += bytes.byteLength;
		return this;
	}

	string(value) {
		const bytes = encoder.encode(String(value ?? "").slice(0, 255));
		this.u8(bytes.byteLength);
		return this.bytes(bytes);
	}

	result() {
		return this.buffer.slice(0, this.offset);
	}
}

class Reader {
	constructor(data) {
		this.buffer = toArrayBuffer(data);
		this.view = new DataView(this.buffer);
		this.offset = 0;
	}

	check(length) {
		if (this.offset + length > this.buffer.byteLength) {
			throw new Error("truncated binary message");
		}
	}

	u8() {
		this.check(1);
		return this.view.getUint8(this.offset++);
	}

	i16() {
		this.check(2);
		const value = this.view.getInt16(this.offset, true);
		this.offset += 2;
		return value;
	}

	u16() {
		this.check(2);
		const value = this.view.getUint16(this.offset, true);
		this.offset += 2;
		return value;
	}

	i32() {
		this.check(4);
		const value = this.view.getInt32(this.offset, true);
		this.offset += 4;
		return value;
	}

	u32() {
		this.check(4);
		const value = this.view.getUint32(this.offset, true);
		this.offset += 4;
		return value;
	}

	f32() {
		this.check(4);
		const value = this.view.getFloat32(this.offset, true);
		this.offset += 4;
		return value;
	}

	bytes(length) {
		this.check(length);
		const slice = this.buffer.slice(this.offset, this.offset + length);
		this.offset += length;
		return new Uint8Array(slice);
	}

	string() {
		return decoder.decode(this.bytes(this.u8()));
	}
}

function header(writer, type) {
	writer.u8(CODEC_VERSION).u8(type);
}

function checkHeader(reader, type) {
	const version = reader.u8();
	if (version !== CODEC_VERSION) {
		throw new Error(`unsupported codec version: ${version}`);
	}
	const actual = reader.u8();
	if (actual !== type) {
		throw new Error(`unexpected binary message type: ${actual}`);
	}
}

function writeBehaviors(writer, behaviors) {
	const list = Array.isArray(behaviors) ? behaviors.slice(0, 255) : [];
	writer.u8(list.length);
	for (const behavior of list) {
		writer.string(behavior?.name);
		writer.i16(signedMs(behavior?.remaining));
	}
}

function readBehaviors(reader) {
	const count = reader.u8();
	const behaviors = [];
	for (let i = 0; i < count; i++) {
		const name = reader.string();
		const remainingMs = reader.i16();
		behaviors.push({
			name,
			remaining: remainingMs < 0 ? null : remainingMs / 1000,
		});
	}
	return behaviors;
}

function writeEntity(writer, data) {
	writer
		.u16(integer(data.id, 0, 65535))
		.u8(KINDS[data.kind] ?? 0)
		.f32(Number(data.x) || 0)
		.f32(Number(data.y) || 0)
		.f32(Number(data.vx) || 0)
		.f32(Number(data.vy) || 0)
		.i16(radians(data.angle))
		.u16(centiseconds(data.age))
		.f32(Number(data.radius) || 0);
	writeBehaviors(writer, data.behaviors);

	switch (data.kind) {
		case "ship":
			writer
				.string(data.playerId)
				.string(data.color)
				.u8(integer(data.hp, 0, 255))
				.u8(integer(data.maxHp, 0, 255))
				.u16(ms(data.fireDelay))
				.u16(ms(data.cooldown))
				.u8(data.thrusting ? 1 : 0);
			break;
		case "bullet":
			writer
				.string(data.ownerId)
				.u32(integer(data.sourceSeq ?? 0, 0, 4294967295))
				.u16(ms(data.ttl))
				.u8(integer(data.damage, 0, 255));
			break;
		case "asteroid": {
			const shape = Array.isArray(data.shape) ? data.shape.slice(0, 255) : [];
			writer
				.u8(integer(data.hp, 0, 255))
				.i16(radians(data.spin))
				.u8(shape.length);
			for (const value of shape)
				writer.u8(integer(Number(value) * 100, 0, 255));
			break;
		}
		case "pickup":
			writer.string(data.effect).u16(ms(data.ttl));
			break;
		case "explosion": {
			const particles = Array.isArray(data.particles)
				? data.particles.slice(0, 255)
				: [];
			writer.string(data.color).u16(ms(data.life)).u8(particles.length);
			for (const particle of particles) {
				writer
					.f32(Number(particle.x) || 0)
					.f32(Number(particle.y) || 0)
					.f32(Number(particle.vx) || 0)
					.f32(Number(particle.vy) || 0)
					.u16(ms(particle.ttl));
			}
			break;
		}
		default:
			throw new Error(`unknown entity kind: ${data.kind}`);
	}
}

function readEntity(reader) {
	const id = reader.u16();
	const kindCode = reader.u8();
	const kind = KIND_NAMES[kindCode];
	if (!kind) throw new Error(`unknown entity kind: ${kindCode}`);
	const data = {
		id,
		kind,
		x: reader.f32(),
		y: reader.f32(),
		vx: reader.f32(),
		vy: reader.f32(),
		angle: reader.i16() / 1000,
		age: reader.u16() / 100,
		radius: reader.f32(),
		behaviors: readBehaviors(reader),
	};

	switch (kind) {
		case "ship":
			data.playerId = reader.string();
			data.color = reader.string();
			data.hp = reader.u8();
			data.maxHp = reader.u8();
			data.fireDelay = reader.u16() / 1000;
			data.cooldown = reader.u16() / 1000;
			data.thrusting = Boolean(reader.u8());
			break;
		case "bullet": {
			data.ownerId = reader.string();
			const sourceSeq = reader.u32();
			data.sourceSeq = sourceSeq === 0 ? null : sourceSeq;
			data.ttl = reader.u16() / 1000;
			data.damage = reader.u8();
			break;
		}
		case "asteroid": {
			data.hp = reader.u8();
			data.spin = reader.i16() / 1000;
			const count = reader.u8();
			data.shape = Array.from({ length: count }, () => reader.u8() / 100);
			break;
		}
		case "pickup":
			data.effect = reader.string();
			data.ttl = reader.u16() / 1000;
			break;
		case "explosion": {
			data.color = reader.string();
			data.life = reader.u16() / 1000;
			const count = reader.u8();
			data.particles = Array.from({ length: count }, () => ({
				x: reader.f32(),
				y: reader.f32(),
				vx: reader.f32(),
				vy: reader.f32(),
				ttl: reader.u16() / 1000,
			}));
			break;
		}
	}
	return data;
}

export function encodeInput(input) {
	const writer = new Writer();
	header(writer, MESSAGE_TYPE.INPUT);
	writer
		.u32(integer(input.seq, 0, 4294967295))
		.u32(integer(input.tick, 0, 4294967295))
		.i16(radians(clamp(input.turn, -1, 1)))
		.u8(input.thrust ? 1 : 0)
		.u8(input.fire ? 1 : 0);
	return writer.result();
}

export function decodeInput(data) {
	const reader = new Reader(data);
	checkHeader(reader, MESSAGE_TYPE.INPUT);
	return {
		type: "input",
		seq: reader.u32(),
		tick: reader.u32(),
		turn: reader.i16() / 1000,
		thrust: Boolean(reader.u8()),
		fire: Boolean(reader.u8()),
	};
}

export function encodeSnapshot(snapshot) {
	const writer = new Writer(2048);
	header(writer, MESSAGE_TYPE.SNAPSHOT);
	writer
		.u32(integer(snapshot.tick, 0, 4294967295))
		.f32(Number(snapshot.arena?.width) || 0)
		.f32(Number(snapshot.arena?.height) || 0);

	const players = Array.isArray(snapshot.players)
		? snapshot.players.slice(0, 65535)
		: [];
	writer.u16(players.length);
	for (const player of players) {
		writer
			.string(player.id)
			.string(player.name)
			.string(player.color)
			.i32(integer(player.score, -2147483648, 2147483647))
			.i32(integer(player.shipId ?? -1, -2147483648, 2147483647))
			.i16(signedMs(player.respawnIn));
	}

	const entities = Array.isArray(snapshot.entities)
		? snapshot.entities.slice(0, 65535)
		: [];
	writer.u16(entities.length);
	for (const entity of entities) writeEntity(writer, entity);

	const events = encoder.encode(
		JSON.stringify(Array.isArray(snapshot.events) ? snapshot.events : []),
	);
	writer.u16(Math.min(events.byteLength, 65535));
	writer.bytes(events.subarray(0, 65535));
	writer.u32(integer(snapshot.lastProcessedSeq, 0, 4294967295));
	return writer.result();
}

export function decodeSnapshot(data) {
	const reader = new Reader(data);
	checkHeader(reader, MESSAGE_TYPE.SNAPSHOT);
	const tick = reader.u32();
	const arena = { width: reader.f32(), height: reader.f32() };

	const playerCount = reader.u16();
	const players = [];
	for (let i = 0; i < playerCount; i++) {
		const id = reader.string();
		const name = reader.string();
		const color = reader.string();
		const score = reader.i32();
		const shipId = reader.i32();
		const respawnInMs = reader.i16();
		players.push({
			id,
			name,
			color,
			score,
			shipId: shipId < 0 ? null : shipId,
			respawnIn: respawnInMs < 0 ? null : respawnInMs / 1000,
		});
	}

	const entityCount = reader.u16();
	const entities = [];
	for (let i = 0; i < entityCount; i++) entities.push(readEntity(reader));

	const eventsLength = reader.u16();
	const events = JSON.parse(decoder.decode(reader.bytes(eventsLength)));
	const lastProcessedSeq = reader.u32();
	return {
		type: "snapshot",
		tick,
		arena,
		players,
		entities,
		events,
		lastProcessedSeq,
	};
}

export function decodeBinaryMessage(data) {
	const buffer = toArrayBuffer(data);
	if (buffer.byteLength < 2) throw new Error("truncated binary message");
	const view = new DataView(buffer);
	const version = view.getUint8(0);
	if (version !== CODEC_VERSION) {
		throw new Error(`unsupported codec version: ${version}`);
	}
	switch (view.getUint8(1)) {
		case MESSAGE_TYPE.INPUT:
			return decodeInput(buffer);
		case MESSAGE_TYPE.SNAPSHOT:
			return decodeSnapshot(buffer);
		default:
			throw new Error("unknown binary message type");
	}
}

export function encodeMessage(message, codec = "json") {
	if (codec === "binary") {
		if (message.type === "input") return encodeInput(message);
		if (message.type === "snapshot") return encodeSnapshot(message);
	}
	return JSON.stringify({ v: CODEC_VERSION, ...message });
}
