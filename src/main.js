import "./style.css";
import { createInput } from "./input.js";
import { createLoop } from "./loop.js";
import { lerp, lerpAngle } from "./math.js";
import { setupCanvas } from "./render/canvas.js";
import { drawArena, drawHud, drawShip } from "./render/draw.js";
import { ARENA, wrapShip } from "./sim/arena.js";
import { createShip, integrate } from "./sim/ship.js";

const canvas = document.getElementById("game");
const { ctx, view } = setupCanvas(canvas);
const input = createInput(window);

let previous = createShip(ARENA.width / 2, ARENA.height / 2);
let current = previous;

function simulate(dt) {
	previous = current;
	current = wrapShip(integrate(current, input, dt), ARENA);
	input.endStep();
}

function interpolate(from, to, alpha) {
	// the ship teleported across the arena edge: do not blend across the screen
	const wrapped =
		Math.abs(to.x - from.x) > ARENA.width / 2 ||
		Math.abs(to.y - from.y) > ARENA.height / 2;
	if (wrapped) return to;

	return {
		...to,
		x: lerp(from.x, to.x, alpha),
		y: lerp(from.y, to.y, alpha),
		angle: lerpAngle(from.angle, to.angle, alpha),
	};
}

const loop = createLoop({
	simulate,
	render(alpha) {
		ctx.clearRect(0, 0, view.width, view.height);

		const scale = Math.min(
			view.width / ARENA.width,
			view.height / ARENA.height,
		);
		ctx.save();
		ctx.translate(
			(view.width - ARENA.width * scale) / 2,
			(view.height - ARENA.height * scale) / 2,
		);
		ctx.scale(scale, scale);
		drawArena(ctx, ARENA);
		drawShip(ctx, interpolate(previous, current, alpha));
		ctx.restore();

		drawHud(ctx, loop.stats);
	},
});

loop.start();
