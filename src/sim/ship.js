import { normalizeAngle } from "../math.js";

export const TURN_RATE = 3.5; // rad/s
export const THRUST = 700; // px/s^2
export const DRAG = 1.5; // 1/s
export const MAX_SPEED = 450; // px/s

export function createShip(x, y) {
	return { x, y, vx: 0, vy: 0, angle: -Math.PI / 2, thrust: false };
}

// pure: returns a new ship, does not touch the old one
export function integrate(ship, input, dt) {
	const left = input.isDown("ArrowLeft") || input.isDown("KeyA");
	const right = input.isDown("ArrowRight") || input.isDown("KeyD");
	const thrust = input.isDown("ArrowUp") || input.isDown("KeyW");

	let angle = ship.angle;
	if (left) angle -= TURN_RATE * dt;
	if (right) angle += TURN_RATE * dt;
	angle = normalizeAngle(angle);

	let vx = ship.vx;
	let vy = ship.vy;
	if (thrust) {
		vx += Math.cos(angle) * THRUST * dt;
		vy += Math.sin(angle) * THRUST * dt;
	}

	const damping = Math.exp(-DRAG * dt);
	vx *= damping;
	vy *= damping;

	const speed = Math.hypot(vx, vy);
	if (speed > MAX_SPEED) {
		vx = (vx / speed) * MAX_SPEED;
		vy = (vy / speed) * MAX_SPEED;
	}

	return {
		x: ship.x + vx * dt,
		y: ship.y + vy * dt,
		vx,
		vy,
		angle,
		thrust,
	};
}
