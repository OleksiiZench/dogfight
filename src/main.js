import "./style.css";
import { createLoop } from "./loop.js";
import { setupCanvas } from "./render/canvas.js";
import { drawHud } from "./render/draw.js";

const canvas = document.getElementById("game");
const { ctx, view } = setupCanvas(canvas);

const loop = createLoop({
	simulate() {
		// physics will go here (M2)
	},
	render() {
		ctx.clearRect(0, 0, view.width, view.height);
		drawHud(ctx, loop.stats);
	},
});

loop.start();
