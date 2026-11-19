// Maps raw keyboard state to a device-independent "intent".
export function keyboardIntent(input) {
	const left = input.isDown("ArrowLeft") || input.isDown("KeyA");
	const right = input.isDown("ArrowRight") || input.isDown("KeyD");
	return {
		turn: Number(right) - Number(left),
		thrust: input.isDown("ArrowUp") || input.isDown("KeyW"),
		fire: input.isDown("Space"),
	};
}
