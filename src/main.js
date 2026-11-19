import "./style.css";
import { createInput } from "./input.js";
import { createLoop } from "./loop.js";
import { setupCanvas } from "./render/canvas.js";
import { drawHud } from "./render/draw.js";
import { ARENA, wrapShip } from "./sim/arena.js";
import { createShip, integrate } from "./sim/ship.js";

const canvas = document.getElementById("game");
const { ctx, view } = setupCanvas(canvas);
const input = createInput(window);

let current = createShip(ARENA.width / 2, ARENA.height / 2);

function simulate(dt) {
	current = wrapShip(integrate(current, input, dt), ARENA);
	input.endStep();
}

const loop = createLoop({
	simulate,
	render() {
		ctx.clearRect(0, 0, view.width, view.height);
		drawHud(ctx, loop.stats);
	},
});

loop.start();
