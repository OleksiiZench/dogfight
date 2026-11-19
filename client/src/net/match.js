import { lerp, lerpAngle } from "shared/math.js";
import { entityFromSnapshot } from "shared/protocol/snapshot.js";
import { DRAW_ORDER, drawEntity } from "../render/draw.js";

function wrappedLerp(from, to, size, alpha) {
	let delta = to - from;
	if (delta > size / 2) delta -= size;
	if (delta < -size / 2) delta += size;
	const value = from + delta * alpha;
	return ((value % size) + size) % size;
}

function interpolateData(previous, next, alpha, arena) {
	const data = { ...next };
	data.x = wrappedLerp(previous.x, next.x, arena.width, alpha);
	data.y = wrappedLerp(previous.y, next.y, arena.height, alpha);
	data.angle = lerpAngle(previous.angle, next.angle, alpha);
	data.vx = lerp(previous.vx, next.vx, alpha);
	data.vy = lerp(previous.vy, next.vy, alpha);
	data.age = lerp(previous.age, next.age, alpha);
	return data;
}

function framePair(frames, targetTime) {
	const first = frames[0];
	const last = frames[frames.length - 1];
	if (!first) return null;
	if (targetTime <= first.receivedAt || targetTime >= last.receivedAt) {
		return [last, last, 0];
	}
	for (let i = 0; i < frames.length - 1; i++) {
		const earlier = frames[i];
		const later = frames[i + 1];
		if (targetTime <= later.receivedAt) {
			const span = later.receivedAt - earlier.receivedAt;
			return [
				earlier,
				later,
				span > 0 ? (targetTime - earlier.receivedAt) / span : 0,
			];
		}
	}
	return [last, last, 0];
}

export class MatchView extends EventTarget {
	constructor({ arena, interpolationDelayMs = 66 } = {}) {
		super();
		this.arena = arena ?? { width: 1600, height: 900 };
		this.interpolationDelayMs = interpolationDelayMs;
		this.tick = 0;
		this.entities = new Map();
		this.players = new Map();
		this.scores = new Map();
		this.lastEntityData = new Map();
		this.history = [];
		this.excludeId = null;
		this.excludeOwnerId = null;
	}

	applySnapshot(snapshot) {
		if (!snapshot || snapshot.tick <= this.tick) return false;
		this.tick = snapshot.tick;
		this.arena = snapshot.arena ?? this.arena;
		this.history.push({
			tick: snapshot.tick,
			receivedAt: performance.now(),
			entities: new Map(snapshot.entities.map((data) => [data.id, data])),
		});
		if (this.history.length > 30) this.history.shift();
		for (const player of snapshot.players ?? []) {
			this.players.set(player.id, player);
			this.scores.set(player.id, player.score);
		}
		this.lastEntityData = new Map(
			snapshot.entities.map((data) => [data.id, data]),
		);
		this.entities = new Map();
		for (const data of snapshot.entities) {
			const entity = entityFromSnapshot(data, this.arena);
			if (entity) this.entities.set(entity.id, entity);
		}
		this.dispatchEvent(new CustomEvent("snapshot", { detail: snapshot }));
		return true;
	}

	setInterpolationDelay(ms) {
		this.interpolationDelayMs = Math.max(0, Math.min(500, ms));
	}

	shipOf(playerId) {
		for (const entity of this.entities.values()) {
			if (entity.kind === "ship" && entity.playerId === playerId) return entity;
		}
		return null;
	}

	interpolatedEntities(now = performance.now()) {
		const pair = framePair(this.history, now - this.interpolationDelayMs);
		if (!pair) return [];
		const [earlier, later, alpha] = pair;
		const result = [];
		for (const [id, next] of later.entities) {
			const previous = earlier === later ? null : earlier.entities.get(id);
			const data =
				previous && previous.kind === next.kind
					? interpolateData(previous, next, alpha, this.arena)
					: next;
			const entity = entityFromSnapshot(data, this.arena);
			if (entity) result.push(entity);
		}
		return result;
	}

	draw(ctx, alpha, sprites) {
		for (const kind of DRAW_ORDER) {
			for (const entity of this.interpolatedEntities()) {
				if (entity.id === this.excludeId) continue;
				if (entity.kind === "bullet" && entity.ownerId === this.excludeOwnerId)
					continue;
				if (entity.kind === kind) drawEntity(ctx, entity, alpha, sprites);
			}
		}
	}
}
