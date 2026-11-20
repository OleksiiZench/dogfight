import type { Intent } from "shared/types.ts";
import type { InputController } from "./input.ts";

// Maps raw keyboard state to a device-independent "intent".
export function keyboardIntent(input: InputController): Intent {
	const left = input.isDown("ArrowLeft") || input.isDown("KeyA");
	const right = input.isDown("ArrowRight") || input.isDown("KeyD");
	return {
		turn: Number(right) - Number(left),
		thrust: input.isDown("ArrowUp") || input.isDown("KeyW"),
		fire: input.isDown("Space"),
	};
}
