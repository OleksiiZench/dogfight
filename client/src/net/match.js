import { entityFromSnapshot } from "shared/protocol/snapshot.js";
import { DRAW_ORDER, drawEntity } from "../render/draw.js";

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
	}

	applySnapshot(snapshot) {
		if (!snapshot || snapshot.tick <= this.tick) return false;
		this.tick = snapshot.tick;
		this.arena = snapshot.arena ?? this.arena;
		this.history.push({
			tick: snapshot.tick,
			receivedAt: performance.now(),
			entities: snapshot.entities,
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

	draw(ctx, alpha, sprites) {
		for (const kind of DRAW_ORDER) {
			for (const entity of this.entities.values()) {
				if (entity.kind === kind) drawEntity(ctx, entity, alpha, sprites);
			}
		}
	}
}
