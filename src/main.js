import "./style.css";
import { keyboardIntent } from "./controls.js";
import { createInput } from "./input.js";
import { createLoop } from "./loop.js";
import { setupCanvas } from "./render/canvas.js";
import {
	DRAW_ORDER,
	drawArena,
	drawEntity,
	drawHud,
	drawScoreboard,
} from "./render/draw.js";
import { ARENA } from "./sim/arena.js";
import { createBot } from "./sim/bot.js";
import { Game } from "./sim/game.js";

const params = new URLSearchParams(window.location.search);
const canvas = document.getElementById("game");
const { ctx, view } = setupCanvas(canvas);
const input = createInput(window);

const game = new Game({ seed: 1 });
game.addPlayer({
	id: "p1",
	name: "YOU",
	color: "#4ade80",
	controller: () => keyboardIntent(input),
});
game.addPlayer({
	id: "bot",
	name: "BOT",
	color: "#f87171",
	controller: createBot(game, "bot"),
	fireDelay: 0.7,
});
game.start();

const me = () => game.players.get("p1");

// Mouse fire. `?naive=1` passes the METHOD itself: the browser then calls it
// with this = canvas, and Ship.fire() throws (see README, "The this bug").
// Default: an arrow function keeps the call `ship.fire()` at the call site,
// and looks the ship up at click time (the ship object changes on respawn).
const onPointerDown =
	params.get("naive") === "1" ? me().ship.fire : () => me().ship?.fire();
canvas.addEventListener("pointerdown", onPointerDown);

function simulate(dt) {
	game.step(dt);
	input.endStep();
}

function render(alpha) {
	ctx.clearRect(0, 0, view.width, view.height);

	const scale = Math.min(view.width / ARENA.width, view.height / ARENA.height);
	ctx.save();
	ctx.translate(
		(view.width - ARENA.width * scale) / 2,
		(view.height - ARENA.height * scale) / 2,
	);
	ctx.scale(scale, scale);
	drawArena(ctx, ARENA);
	for (const kind of DRAW_ORDER) {
		for (const entity of game.world.ofKind(kind)) {
			drawEntity(ctx, entity, alpha);
		}
	}
	ctx.restore();

	drawScoreboard(ctx, game, view, "p1");
	drawHud(ctx, loop.stats);
}

const loop = createLoop({ simulate, render });
loop.start();
