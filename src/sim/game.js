import { dispatch } from "../events/bus.js";
import { createRng } from "../math.js";
import { ARENA, randomPoint } from "./arena.js";
import { Asteroid } from "./asteroid.js";
import { EFFECTS, homing, timedEffect } from "./behaviors.js";
import { Pickup } from "./pickup.js";
import { Ship } from "./ship.js";
import { World } from "./world.js";

export const RESPAWN_DELAY = 2;
const KILL_SCORE = 100;
const ASTEROID_SCORE = 10;
const ASTEROID_TARGET = 6;
const ASTEROID_DELAY = 2;
const PICKUP_MAX = 2;
const PICKUP_INTERVAL = 8;

// Game rules on top of World: players, score, respawn, spawners.
export class Game {
	constructor({ seed = 1, arena, asteroidTarget = ASTEROID_TARGET, bus } = {}) {
		this.rng = createRng(seed);
		this.arena = { ...ARENA, ...arena };
		this.asteroidTarget = asteroidTarget;
		this.bus = bus;
		this.world = new World({ rng: this.rng, arena: this.arena });
		this.players = new Map(); // playerId -> player record
		this.asteroidTimer = 0;
		this.pickupTimer = PICKUP_INTERVAL;
	}

	// controller: () => ({ turn, thrust, fire })
	addPlayer({ id, name, color, controller, fireDelay = 0.25 }) {
		const player = {
			id,
			name,
			color,
			controller,
			fireDelay,
			score: 0,
			ship: null,
			respawnIn: null,
		};
		this.players.set(id, player);
		this.spawnShip(player);
		return player;
	}

	start() {
		for (let i = 0; i < this.asteroidTarget; i++) this.spawnAsteroid();
		this.publishScores();
	}

	publishScores() {
		const scores = new Map();
		for (const [id, player] of this.players) scores.set(id, player.score);
		dispatch(this.bus, "scoreChanged", { scores });
	}

	step(dt) {
		const intents = new Map();
		for (const player of this.players.values()) {
			if (player.ship?.alive) intents.set(player.ship.id, player.controller());
		}

		this.world.step(dt, intents);
		this.processEvents();
		this.updateRespawns(dt);
		this.maintainAsteroids(dt);
		this.maintainPickups(dt);
	}

	processEvents() {
		let scoresChanged = false;
		for (const event of this.world.drainEvents()) {
			const killer = this.players.get(event.killerId);

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
			dispatch(this.bus, event.type, event);
		}
		if (scoresChanged) this.publishScores();
	}

	updateRespawns(dt) {
		for (const player of this.players.values()) {
			if (player.respawnIn === null) continue;
			player.respawnIn -= dt;
			if (player.respawnIn <= 0) this.spawnShip(player);
		}
	}

	spawnShip(player) {
		const ship = new Ship({
			playerId: player.id,
			color: player.color,
			pos: this.findSafeSpot(260),
			fireDelay: player.fireDelay,
		});
		// brief spawn protection
		ship.addBehavior(timedEffect("shield", 2));
		this.world.spawn(ship);
		player.ship = ship;
		player.respawnIn = null;
	}

	spawnAsteroid() {
		const asteroid = Asteroid.random(this.rng, this.findSafeSpot(250));
		// some asteroids hunt ships: same homing behaviour a bullet can use
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

	// random point far from ships and asteroids (best of 20 tries)
	findSafeSpot(minDistance) {
		let best = null;
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
		return best;
	}

	maintainAsteroids(dt) {
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

	maintainPickups(dt) {
		let count = 0;
		for (const _ of this.world.ofKind("pickup")) count++;
		if (count >= PICKUP_MAX) return;
		this.pickupTimer -= dt;
		if (this.pickupTimer > 0) return;

		this.pickupTimer = PICKUP_INTERVAL;
		this.world.spawn(
			new Pickup({
				pos: this.findSafeSpot(120),
				effect: this.rng.pick([...EFFECTS.keys()]),
			}),
		);
	}
}
