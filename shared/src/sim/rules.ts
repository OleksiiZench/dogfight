import type { Asteroid } from "./asteroid.ts";
import { EFFECTS, timedEffect } from "./behaviors.ts";
import type { Bullet } from "./bullet.ts";
import type { AnyEntity } from "./entity.ts";
import { Explosion } from "./explosion.ts";
import type { Pickup } from "./pickup.ts";
import type { Ship } from "./ship.ts";
import type { WorldLike } from "./world.ts";

const ASTEROID_DAMAGE = 25;

function explode(
	world: WorldLike,
	entity: AnyEntity,
	options: {
		color?: string;
		count?: number;
		speed?: number;
		life?: number;
	},
): void {
	world.spawn(
		new Explosion({
			id: world.nextId(),
			pos: entity.pos,
			rng: world.rng,
			...options,
		}),
	);
}

function bulletHitsShip(bullet: Bullet, ship: Ship, world: WorldLike): void {
	if (!bullet.alive || !ship.alive) return;
	if (bullet.ownerId === ship.playerId) return;

	bullet.kill();
	world.emit({ type: "hit", target: "ship", pos: ship.pos });
	if (ship.damage(bullet.damage)) {
		explode(world, ship, { color: ship.color, count: 40, speed: 320, life: 1 });
		world.emit({ type: "exploded", pos: ship.pos, color: ship.color });
		world.emit({ type: "shipDestroyed", ship, killerId: bullet.ownerId });
	}
}

function bulletHitsAsteroid(
	bullet: Bullet,
	asteroid: Asteroid,
	world: WorldLike,
): void {
	if (!bullet.alive || !asteroid.alive) return;

	bullet.kill();
	world.emit({ type: "hit", target: "asteroid", pos: asteroid.pos });
	if (asteroid.damage(bullet.damage)) {
		explode(world, asteroid, { color: "#9ca3af", count: 20, speed: 160 });
		world.emit({ type: "exploded", pos: asteroid.pos, color: "#9ca3af" });
		world.emit({ type: "asteroidDestroyed", killerId: bullet.ownerId });
	}
}

function shipHitsAsteroid(
	ship: Ship,
	asteroid: Asteroid,
	world: WorldLike,
): void {
	if (!ship.alive || !asteroid.alive) return;

	// push the ship out and reflect its velocity off the asteroid
	const normal = ship.pos.sub(asteroid.pos).normalize();
	ship.pos = asteroid.pos.add(normal.scale(ship.radius + asteroid.radius));
	const into = ship.vel.dot(normal);
	if (into < 0) ship.vel = ship.vel.sub(normal.scale(2 * into));

	if (ship.invulnerable) return;
	world.emit({ type: "hit", target: "ship", pos: ship.pos });
	if (ship.damage(ASTEROID_DAMAGE)) {
		explode(world, ship, { color: ship.color, count: 40, speed: 320, life: 1 });
		world.emit({ type: "exploded", pos: ship.pos, color: ship.color });
		world.emit({ type: "shipDestroyed", ship, killerId: null });
	} else {
		ship.addBehavior(timedEffect("invuln", 1));
	}
}

function shipTakesPickup(ship: Ship, pickup: Pickup, world: WorldLike): void {
	if (!ship.alive || !pickup.alive) return;
	pickup.kill();
	EFFECTS.get(pickup.effect)?.apply(ship);
	world.emit({ type: "pickup", effect: pickup.effect, pos: pickup.pos });
}

export function resolveCollision(
	a: AnyEntity,
	b: AnyEntity,
	world: WorldLike,
): void {
	if (a.kind === "bullet" && b.kind === "ship") {
		bulletHitsShip(a, b, world);
		return;
	}
	if (b.kind === "bullet" && a.kind === "ship") {
		bulletHitsShip(b, a, world);
		return;
	}
	if (a.kind === "bullet" && b.kind === "asteroid") {
		bulletHitsAsteroid(a, b, world);
		return;
	}
	if (b.kind === "bullet" && a.kind === "asteroid") {
		bulletHitsAsteroid(b, a, world);
		return;
	}
	if (a.kind === "ship" && b.kind === "asteroid") {
		shipHitsAsteroid(a, b, world);
		return;
	}
	if (b.kind === "ship" && a.kind === "asteroid") {
		shipHitsAsteroid(b, a, world);
		return;
	}
	if (a.kind === "ship" && b.kind === "pickup") {
		shipTakesPickup(a, b, world);
		return;
	}
	if (b.kind === "ship" && a.kind === "pickup") {
		shipTakesPickup(b, a, world);
	}
}
