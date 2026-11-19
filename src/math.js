export function lerp(a, b, t) {
	return a + (b - a) * t;
}

export function clamp(value, min, max) {
	return Math.min(max, Math.max(min, value));
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

// small seeded PRNG (mulberry32): same seed -> same sequence
export function createRng(seed = 1) {
	let state = seed >>> 0;

	const next = () => {
		state = (state + 0x6d2b79f5) >>> 0;
		let t = state;
		t = Math.imul(t ^ (t >>> 15), t | 1);
		t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	};

	return {
		next,
		range: (min, max) => min + (max - min) * next(),
		pick: (items) => items[Math.floor(next() * items.length)],
	};
}
