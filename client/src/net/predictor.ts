import { lerp, lerpAngle } from "shared/math.ts";
import { beginProfile, endProfile } from "shared/profile.ts";
import { entityFromSnapshot, serializeEntity } from "shared/protocol.ts";
import type { Bullet } from "shared/sim/bullet.ts";
import type { AnyEntity } from "shared/sim/entity.ts";
import type { Ship } from "shared/sim/ship.ts";
import type { Vector2 } from "shared/sim/vector.ts";
import type { WorldLike } from "shared/sim/world.ts";
import { createStaticWorld } from "shared/sim/world.ts";
import type {
	Arena,
	EntityData,
	EntityId,
	GameEvent,
	Intent,
	PlayerId,
	Snapshot,
} from "shared/types.ts";
import { asEntityId, asSeq } from "shared/types.ts";
import { drawEntity } from "../render/draw.ts";
import type { Sprites } from "../render/sprites.ts";
import {
	pendingAfterAck,
	reconcileBulletKeys,
	wrappedDistance,
} from "./reconcile.ts";

function shipFrom(data: EntityData, arena: Arena): Ship | null {
	const entity = entityFromSnapshot(data, arena);
	return entity?.kind === "ship" ? entity : null;
}

function bulletFrom(data: EntityData, arena: Arena): Bullet | null {
	const entity = entityFromSnapshot(data, arena);
	return entity?.kind === "bullet" ? entity : null;
}

export interface PredictorWorld {
	arena: Arena;
	owner: Predictor;
	nextId(): EntityId;
	spawn(entity: AnyEntity): void;
	emit(event: GameEvent): void;
}

function asWorld(world: PredictorWorld): WorldLike {
	const base = createStaticWorld(world.arena);
	return {
		...base,
		nextId: () => world.nextId(),
		spawn(entity) {
			world.spawn(entity);
			return entity;
		},
		emit: (event) => world.emit(event),
	};
}

export interface PredictorOptions {
	arena?: Arena | null;
	localId: PlayerId;
	stepSeconds?: number;
}

export interface PredictorConnection {
	stats: { correction: number; pendingInputs: number };
}

export interface PendingInput {
	seq: number;
	tick: number;
	intent: Intent;
}

export class Predictor {
	arena: Arena;
	localId: PlayerId;
	stepSeconds: number;
	ship: Ship | null;
	visualShip: Ship | null;
	visualPos: Vector2 | null;
	visualAngle: number;
	lastVisualAt: number;
	pending: PendingInput[];
	predictedBullets: Map<number, Bullet>;
	confirmedBullets: Map<number, Bullet>;
	seq: number;
	tick: number;
	world: PredictorWorld;

	constructor({ arena, localId, stepSeconds = 1 / 30 }: PredictorOptions) {
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
			nextId: () => asEntityId(-1000 - this.seq),
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

	get shipId(): EntityId | null {
		return this.ship?.id ?? null;
	}

	applyIntent(intent: Intent): PendingInput {
		this.seq += 1;
		this.tick += 1;
		const record: PendingInput = {
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

	stepShip(intent: Intent, seq: number): void {
		if (!this.ship) return;
		this.ship.savePrevious();
		this.ship.control({ ...intent, seq: asSeq(seq) }, this.stepSeconds);
		this.ship.update(this.stepSeconds);
	}

	stepBullets(): void {
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

	reconcileBullets(snapshot: Snapshot, ack: number): void {
		this.arena = snapshot.arena ?? this.arena;
		this.world.arena = this.arena;
		const result = reconcileBulletKeys(
			snapshot,
			this.localId,
			ack,
			this.predictedBullets.keys(),
			this.confirmedBullets.keys(),
		);
		for (const { key, data } of result.confirmed) {
			const bullet = bulletFrom(data, this.arena);
			if (bullet) this.confirmedBullets.set(key, bullet);
		}
		for (const key of result.confirmedToDelete)
			this.confirmedBullets.delete(key);
		for (const key of result.predictedToDelete)
			this.predictedBullets.delete(key);
	}

	reconcile(snapshot: Snapshot, connection: PredictorConnection): void {
		const token = beginProfile("reconcile");
		try {
			this.reconcileInner(snapshot, connection);
		} finally {
			endProfile(token, "reconcile");
		}
	}

	reconcileInner(snapshot: Snapshot, connection: PredictorConnection): void {
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

		const authoritative = shipFrom(data, this.arena);
		if (!authoritative) return;
		const correction =
			this.ship?.id === data.id
				? wrappedDistance(this.ship.pos, authoritative.pos, this.arena)
				: 0;
		connection.stats.correction = correction;
		authoritative.world = asWorld(this.world);
		this.ship = authoritative;
		this.pending = pendingAfterAck(this.pending, ack);
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
		this.visualShip = shipFrom(serializeEntity(this.ship), this.arena);
		if (!this.visualShip) return;
		this.visualShip.world = createStaticWorld(this.arena);
	}

	updateVisual(now = performance.now()): void {
		if (!this.ship || !this.visualShip || !this.visualPos) return;
		const delta = Math.min((now - this.lastVisualAt) / 1000, 0.1);
		this.lastVisualAt = now;
		const blend = 1 - Math.exp(-delta / 0.05);
		this.visualPos.set(
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

	draw(
		ctx: CanvasRenderingContext2D,
		alpha: number,
		sprites: Sprites | null,
	): void {
		for (const bullet of this.confirmedBullets.values())
			drawEntity(ctx, bullet, alpha, sprites);
		for (const bullet of this.predictedBullets.values())
			drawEntity(ctx, bullet, alpha, sprites);
		if (this.visualShip) drawEntity(ctx, this.visualShip, alpha, sprites);
	}
}
