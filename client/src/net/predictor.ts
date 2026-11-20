import { lerp, lerpAngle } from "shared/math.js";
import {
	entityFromSnapshot,
	serializeEntity,
} from "shared/protocol/snapshot.js";
import { Vector2 } from "shared/sim/vector.js";
import { drawEntity } from "../render/draw.js";

function wrappedDistance(a, b, arena) {
	const dx = Math.abs(a.x - b.x);
	const dy = Math.abs(a.y - b.y);
	return Math.hypot(
		Math.min(dx, arena.width - dx),
		Math.min(dy, arena.height - dy),
	);
}

export class Predictor {
	constructor({ arena, localId, stepSeconds = 1 / 30 }) {
		this.arena = arena ?? { width: 1600, height: 900 };
		this.localId = localId;
		this.stepSeconds = stepSeconds;
		this.ship = null;
		this.visualShip = null;
		this.visualPos = null;
		this.visualAngle = 0;
		this.lastVisualAt = performance.now();
		this.pending = [];
		this.predictedBullets = new Map();
		this.confirmedBullets = new Map();
		this.seq = 0;
		this.tick = 0;
		this.world = {
			arena: this.arena,
			owner: this,
			nextId: () => -1000 - this.seq,
			spawn(entity) {
				if (entity.kind === "bullet") {
					this.owner.predictedBullets.set(
						entity.sourceSeq ?? entity.id,
						entity,
					);
				}
			},
			emit() {},
		};
	}

	get shipId() {
		return this.ship?.id ?? null;
	}

	applyIntent(intent) {
		this.seq += 1;
		this.tick += 1;
		const record = {
			seq: this.seq,
			tick: this.tick,
			intent: { ...intent },
		};
		this.pending.push(record);
		if (this.ship) {
			this.stepShip(record.intent, record.seq);
			this.stepBullets();
		}
		return record;
	}

	stepShip(intent, seq) {
		this.ship.savePrevious();
		this.ship.control({ ...intent, seq }, this.stepSeconds);
		this.ship.update(this.stepSeconds);
	}

	stepBullets() {
		for (const [key, bullet] of this.predictedBullets) {
			bullet.savePrevious();
			bullet.update(this.stepSeconds);
			if (!bullet.alive) this.predictedBullets.delete(key);
		}
		for (const [key, bullet] of this.confirmedBullets) {
			bullet.savePrevious();
			bullet.update(this.stepSeconds);
			if (!bullet.alive) this.confirmedBullets.delete(key);
		}
	}

	reconcileBullets(snapshot, ack) {
		this.arena = snapshot.arena ?? this.arena;
		this.world.arena = this.arena;
		const seen = new Set();
		for (const data of snapshot.entities ?? []) {
			if (data.kind !== "bullet" || data.ownerId !== this.localId) continue;
			const key = data.sourceSeq ?? data.id;
			seen.add(key);
			this.confirmedBullets.set(key, entityFromSnapshot(data, this.arena));
			if (data.sourceSeq !== null && data.sourceSeq !== undefined) {
				this.predictedBullets.delete(data.sourceSeq);
			}
		}
		for (const key of [...this.confirmedBullets.keys()]) {
			if (!seen.has(key)) this.confirmedBullets.delete(key);
		}
		for (const [key] of [...this.predictedBullets]) {
			if (key <= ack) this.predictedBullets.delete(key);
		}
	}

	reconcile(snapshot, connection) {
		this.reconcileBullets(snapshot, Number(snapshot.lastProcessedSeq ?? 0));
		const ack = Number(snapshot.lastProcessedSeq ?? 0);
		const data = snapshot.entities?.find(
			(entity) => entity.kind === "ship" && entity.playerId === this.localId,
		);

		if (!data) {
			this.ship = null;
			this.visualShip = null;
			this.visualPos = null;
			this.pending = [];
			connection.stats.pendingInputs = 0;
			return;
		}

		const authoritative = entityFromSnapshot(data, this.arena);
		const correction =
			this.ship?.id === data.id
				? wrappedDistance(this.ship.pos, authoritative.pos, this.arena)
				: 0;
		connection.stats.correction = correction;
		authoritative.world = this.world;
		this.ship = authoritative;
		this.pending = this.pending.filter((record) => record.seq > ack);
		for (const record of this.pending) {
			this.stepShip(record.intent, record.seq);
			this.stepBullets();
		}
		connection.stats.pendingInputs = this.pending.length;

		const teleported =
			!this.visualPos ||
			this.visualShip?.id !== data.id ||
			correction > Math.min(this.arena.width, this.arena.height) / 4;
		if (teleported) {
			this.visualPos = this.ship.pos;
			this.visualAngle = this.ship.angle;
		}
		this.visualShip = entityFromSnapshot(
			serializeEntity(this.ship),
			this.arena,
		);
		this.visualShip.world = { arena: this.arena };
	}

	updateVisual(now = performance.now()) {
		if (!this.ship || !this.visualShip || !this.visualPos) return;
		const delta = Math.min((now - this.lastVisualAt) / 1000, 0.1);
		this.lastVisualAt = now;
		const blend = 1 - Math.exp(-delta / 0.05);
		this.visualPos = new Vector2(
			lerp(this.visualPos.x, this.ship.pos.x, blend),
			lerp(this.visualPos.y, this.ship.pos.y, blend),
		);
		this.visualAngle = lerpAngle(this.visualAngle, this.ship.angle, blend);
		this.visualShip.pos = this.visualPos;
		this.visualShip.prevPos = this.visualPos;
		this.visualShip.angle = this.visualAngle;
		this.visualShip.prevAngle = this.visualAngle;
		this.visualShip.vel = this.ship.vel;
		this.visualShip.age = this.ship.age;
		this.visualShip.thrusting = this.ship.thrusting;
	}

	draw(ctx, alpha, sprites) {
		for (const bullet of this.confirmedBullets.values())
			drawEntity(ctx, bullet, alpha, sprites);
		for (const bullet of this.predictedBullets.values())
			drawEntity(ctx, bullet, alpha, sprites);
		if (this.visualShip) drawEntity(ctx, this.visualShip, alpha, sprites);
	}
}
