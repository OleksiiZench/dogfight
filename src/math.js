export function lerp(a, b, t) {
	return a + (b - a) * t;
}

// wraps any angle into [-PI, PI)
export function normalizeAngle(angle) {
	const twoPi = Math.PI * 2;
	return angle - twoPi * Math.floor((angle + Math.PI) / twoPi);
}

// interpolates along the shortest arc
export function lerpAngle(a, b, t) {
	return a + normalizeAngle(b - a) * t;
}
