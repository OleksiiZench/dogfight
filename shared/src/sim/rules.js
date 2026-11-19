import { EFFECTS, timedEffect } from "./behaviors.js";
import { Explosion } from "./explosion.js";

const ASTEROID_DAMAGE = 25;

function explode(world, entity, options) {
	world.spawn(
		new Explosion({
			id: world.nextId(),
			pos: entity.pos,
			rng: world.rng,
			...options,
		}),
	);
}

function bulletHitsShip(bullet, ship, world) {
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

function bulletHitsAsteroid(bullet, asteroid, world) {
	if (!bullet.alive || !asteroid.alive) return;

	bullet.kill();
	world.emit({ type: "hit", target: "asteroid", pos: asteroid.pos });
	if (asteroid.damage(bullet.damage)) {
		explode(world, asteroid, { color: "#9ca3af", count: 20, speed: 160 });
		world.emit({ type: "exploded", pos: asteroid.pos, color: "#9ca3af" });
		world.emit({ type: "asteroidDestroyed", killerId: bullet.ownerId });
	}
}

function shipHitsAsteroid(ship, asteroid, world) {
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

function shipTakesPickup(ship, pickup, world) {
	if (!ship.alive || !pickup.alive) return;
	pickup.kill();
	EFFECTS.get(pickup.effect)?.apply(ship);
	world.emit({ type: "pickup", effect: pickup.effect, pos: pickup.pos });
}

// handler(a, b) is called with a.kind and b.kind in the order of the key
const HANDLERS = new Map([
	["bullet:ship", bulletHitsShip],
	["bullet:asteroid", bulletHitsAsteroid],
	["ship:asteroid", shipHitsAsteroid],
	["ship:pickup", shipTakesPickup],
]);

export function resolveCollision(a, b, world) {
	const direct = HANDLERS.get(`${a.kind}:${b.kind}`);
	if (direct) return direct(a, b, world);
	const swapped = HANDLERS.get(`${b.kind}:${a.kind}`);
	if (swapped) return swapped(b, a, world);
}
