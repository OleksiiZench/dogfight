export const EMPTY_INTENT = Object.freeze({
	turn: 0,
	thrust: false,
	fire: false,
});

function integer(value, name, min, max) {
	const number = Number(value);
	if (!Number.isInteger(number) || number < min || number > max) {
		throw new Error(`${name} has to be an integer between ${min} and ${max}`);
	}
	return number;
}

export function validateInput(raw) {
	if (!raw || typeof raw !== "object" || Array.isArray(raw))
		throw new Error("input has to be an object");
	const seq = integer(raw.seq, "seq", 0, 2 ** 31 - 1);
	const tick = integer(raw.tick, "tick", 0, 2 ** 31 - 1);
	const turn = Number(raw.turn);
	if (!Number.isFinite(turn)) throw new Error("turn has to be a number");
	return {
		type: "input",
		seq,
		tick,
		turn: Math.max(-1, Math.min(1, turn)),
		thrust: Boolean(raw.thrust),
		fire: Boolean(raw.fire),
	};
}

export function intentOf(input) {
	if (!input) return EMPTY_INTENT;
	return {
		seq: input.seq,
		turn: input.turn,
		thrust: input.thrust,
		fire: input.fire,
	};
}
