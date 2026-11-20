import { createRng } from "../math.ts";
import { serializeEntity, serializeEvent } from "../protocol/snapshot.ts";
import type {
	Arena,
	EntityId,
	GameEvent,
	Intent,
	PlayerId,
	Rng,
	Snapshot,
} from "../types.ts";
import { randomPoint } from "./arena.ts";
import { Asteroid } from "./asteroid.ts";
import { EFFECTS, homing, timedEffect } from "./behaviors.ts";
import { Pickup } from "./pickup.ts";
import { Ship } from "./ship.ts";
import { Vector2 } from "./vector.ts";
import { World } from "./world.ts";

export const RESPAWN_DELAY = 2;
const KILL_SCORE = 100;
const ASTEROID_SCORE = 10;
const ASTEROID_TARGET = 6;
const ASTEROID_DELAY = 2;
const PICKUP_MAX = 2;
const PICKUP_INTERVAL = 8;

export interface Player {
	id: PlayerId;
	name: string;
	color: string;
	fireDelay: number;
	score: number;
	ship: Ship | null;
	shipId: EntityId | null;
	respawnIn: number | null;
}

export class Game {
	readonly rng: Rng;
	readonly arena: Arena;
	readonly world: World;
	readonly players: Map<PlayerId, Player>;
	asteroidTarget: number;
	asteroidTimer: number;
	pickupTimer: number;

	constructor({
		seed = 1,
		arena,
		asteroidTarget = ASTEROID_TARGET,
		idStart = 1,
	}: {
		seed?: number;
		arena?: Arena;
		asteroidTarget?: number;
		idStart?: number;
	} = {}) {
		this.rng = createRng(seed);
		this.arena = arena ?? { width: 1600, height: 900 };
		this.asteroidTarget = asteroidTarget;
		this.world = new World({ rng: this.rng, arena: this.arena, idStart });
		this.players = new Map();
		this.asteroidTimer = 0;
		this.pickupTimer = PICKUP_INTERVAL;
	}

	addPlayer({
		id,
		name,
		color,
		fireDelay = 0.25,
	}: {
		id: PlayerId;
		name: string;
		color: string;
		fireDelay?: number;
	}): Player {
		const player: Player = {
			id,
			name,
			color,
			fireDelay,
			score: 0,
			ship: null,
			shipId: null,
			respawnIn: null,
		};
		this.players.set(id, player);
		this.spawnShip(player);
		return player;
	}

	removePlayer(id: PlayerId): Player | null {
		const player = this.players.get(id);
		if (!player) return null;
		if (player.ship) this.world.despawn(player.ship.id);
		this.players.delete(id);
		return player;
	}

	start(): void {
		for (let i = 0; i < this.asteroidTarget; i++) this.spawnAsteroid();
	}

	step(
		dt: number,
		intents: ReadonlyMap<EntityId, Intent> = new Map(),
	): GameEvent[] {
		this.world.step(dt, intents);
		const events = this.processEvents();
		this.updateRespawns(dt);
		this.maintainAsteroids(dt);
		this.maintainPickups(dt);
		return events;
	}

	processEvents(): GameEvent[] {
		const events: GameEvent[] = [];
		let scoresChanged = false;
		for (const event of this.world.drainEvents()) {
			const killerId = "killerId" in event ? event.killerId : null;
			const killer = killerId ? this.players.get(killerId) : undefined;

			if (event.type === "shipDestroyed") {
				const victim = this.players.get(event.ship.playerId);
				if (victim) victim.respawnIn = RESPAWN_DELAY;
				if (killer && killer !== victim) {
					killer.score += KILL_SCORE;
					scoresChanged = true;
				}
			} else if (event.type === "asteroidDestroyed") {
				if (killer) {
					killer.score += ASTEROID_SCORE;
					scoresChanged = true;
				}
			}
			events.push(serializeEvent(event));
		}
		if (scoresChanged) {
			events.push({
				type: "scoreChanged",
				scores: Object.fromEntries(
					[...this.players].map(([id, player]) => [id, player.score]),
				),
			});
		}
		return events;
	}

	updateRespawns(dt: number): void {
		for (const player of this.players.values()) {
			if (player.respawnIn === null) continue;
			player.respawnIn -= dt;
			if (player.respawnIn <= 0) this.spawnShip(player);
		}
	}

	spawnShip(player: Player): void {
		const ship = new Ship({
			id: this.world.nextId(),
			playerId: player.id,
			color: player.color,
			pos: this.findSafeSpot(260),
			fireDelay: player.fireDelay,
		});
		ship.addBehavior(timedEffect("shield", 2));
		this.world.spawn(ship);
		player.ship = ship;
		player.shipId = ship.id;
		player.respawnIn = null;
	}

	spawnAsteroid(): void {
		const asteroid = Asteroid.random(
			this.rng,
			this.findSafeSpot(250),
			this.world.nextId(),
		);
		if (this.rng.next() < 0.25) {
			asteroid.addBehavior(
				homing({
					turnRate: 0.6,
					range: 700,
					canTarget: (_self, other) => other.kind === "ship",
				}),
			);
		}
		this.world.spawn(asteroid);
	}

	findSafeSpot(minDistance: number): Vector2 {
		let best: Vector2 | null = null;
		let bestClearance = -Infinity;

		for (let attempt = 0; attempt < 20; attempt++) {
			const point = randomPoint(this.rng, 60, this.arena);
			let clearance = Number.POSITIVE_INFINITY;
			for (const entity of this.world) {
				if (!entity.alive || !entity.solid) continue;
				if (entity.kind !== "ship" && entity.kind !== "asteroid") continue;
				clearance = Math.min(
					clearance,
					entity.pos.distanceTo(point) - entity.radius,
				);
			}
			if (clearance >= minDistance) return point;
			if (clearance > bestClearance) {
				bestClearance = clearance;
				best = point;
			}
		}
		return best ?? new Vector2();
	}

	maintainAsteroids(dt: number): void {
		let count = 0;
		for (const _ of this.world.ofKind("asteroid")) count++;
		if (count >= this.asteroidTarget) {
			this.asteroidTimer = ASTEROID_DELAY;
			return;
		}
		this.asteroidTimer -= dt;
		if (this.asteroidTimer <= 0) {
			this.spawnAsteroid();
			this.asteroidTimer = ASTEROID_DELAY;
		}
	}

	maintainPickups(dt: number): void {
		let count = 0;
		for (const _ of this.world.ofKind("pickup")) count++;
		if (count >= PICKUP_MAX) return;
		this.pickupTimer -= dt;
		if (this.pickupTimer > 0) return;

		this.pickupTimer = PICKUP_INTERVAL;
		this.world.spawn(
			new Pickup({
				id: this.world.nextId(),
				pos: this.findSafeSpot(120),
				effect: this.rng.pick([...EFFECTS.keys()]) ?? "shield",
			}),
		);
	}

	snapshot(tick = 0): Snapshot {
		return {
			type: "snapshot",
			tick,
			arena: this.arena,
			entities: [...this.world].map(serializeEntity),
			players: [...this.players.values()].map((player) => ({
				id: player.id,
				name: player.name,
				color: player.color,
				score: player.score,
				shipId: player.shipId,
				respawnIn: player.respawnIn,
			})),
		};
	}
}
