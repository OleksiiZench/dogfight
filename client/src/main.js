import "./style.css";
import {
	fetchJson,
	isCancellation,
	loadAll,
	loadJson,
} from "./assets/loader.js";
import { attachAudio, createAudio } from "./audio/audio.js";
import { keyboardIntent } from "./controls.js";
import { createBus } from "./events/bus.js";
import { createInput } from "./input.js";
import { createLoop } from "./loop.js";
import { Connection } from "./net/connection.js";
import { Lobby } from "./net/lobby.js";
import { setupCanvas } from "./render/canvas.js";
import {
	DRAW_ORDER,
	drawArena,
	drawEntity,
	drawHud,
	drawScoreboard,
} from "./render/draw.js";
import { createSprites } from "./render/sprites.js";
import { createBot } from "./sim/bot.js";
import { Game } from "./sim/game.js";
import { createChatPanel } from "./ui/chatView.js";
import { createHud } from "./ui/hud.js";
import { createLoadingScreen } from "./ui/loading.js";
import { createLobbyView } from "./ui/lobbyView.js";

const MANIFEST_URL = "/assets/manifest.json";
const params = new URLSearchParams(window.location.search);
const canvas = document.getElementById("game");
const { ctx, view } = setupCanvas(canvas);
const input = createInput(window);
const bus = createBus();
const audio = createAudio();
const connection = new Connection();
const hud = createHud(bus);
attachAudio(bus, audio);

let bootController = null;
let loading = null;
let lobbyView = null;

function debugManifest(manifest) {
	const copy = structuredClone(manifest);
	const failure = params.get("fail");
	if (failure === "404") copy.sprites.sheet = "/debug/404";
	if (failure === "json") copy.arena = "/debug/badjson";
	return copy;
}

function debugJobs() {
	const jobs = [];
	const failure = params.get("fail");
	const signal = bootController.signal;

	const slowCount = Number(params.get("slow")) || (failure === "abort" ? 1 : 0);
	for (let i = 0; i < slowCount; i++) {
		jobs.push({
			name: `slow asset ${i + 1}`,
			group: "extras",
			required: false,
			fallback: {},
			load: () => loadJson("/debug/slow", { signal }),
		});
	}
	if (failure === "timeout") {
		jobs.push({
			name: "timeout asset",
			group: "extras",
			required: false,
			fallback: {},
			load: () => loadJson("/debug/slow", { signal, timeoutMs: 800 }),
		});
	}
	if (params.get("retry") === "1") {
		jobs.push({
			name: "flaky asset",
			group: "extras",
			required: true,
			load: () => loadJson("/debug/flaky", { signal }),
		});
	}
	return jobs;
}

async function boot() {
	bootController?.abort();
	bootController = new AbortController();
	const { signal } = bootController;
	const failures = [];

	loading ??= createLoadingScreen({
		canvas,
		ctx,
		view,
		onRetry: () => void boot(),
		onCancel: () => bootController?.abort(),
	});
	loading.setState({
		phase: "loading",
		done: 0,
		total: 1,
		name: "manifest",
		failures,
		message: "",
	});

	try {
		const manifest = debugManifest(await fetchJson(MANIFEST_URL, { signal }));
		const started = performance.now();
		const assets = await loadAll(manifest, {
			ctx: audio.context,
			signal,
			extra: debugJobs(),
			sequential: params.get("sequential") === "1",
			onProgress: ({ done, total, name, error }) => {
				if (error) failures.push({ name, error });
				loading.setState({ done, total, name });
			},
		});
		const elapsed = performance.now() - started;
		const mode = params.get("sequential") === "1" ? "sequential" : "concurrent";
		console.log(`[loadAll] ${mode}: ${elapsed.toFixed(0)} ms`);

		for (const [name, buffer] of Object.entries(assets.sounds)) {
			audio.set(name, buffer);
		}

		loading.dispose();
		loading = null;
		showLobby(manifest.rooms ?? "/api/rooms", {
			arena: assets.arena,
			sprites: createSprites(assets.sprites.sheet),
		});
	} catch (error) {
		console.error("[loading]", error);
		loading.setState({
			phase: isCancellation(error) ? "cancelled" : "error",
			message: error.message,
		});
	}
}

function showLobby(roomsUrl, assets) {
	const lobby = new Lobby({ url: roomsUrl, connection });
	lobbyView = createLobbyView({ mount: document.body, lobby });

	lobby.addEventListener("joined", ({ detail }) => {
		void audio.unlock();
		console.log(`[lobby] ${detail.name} → ${detail.room.id}`);
	});

	lobby.addEventListener("start", ({ detail }) => {
		lobby.detach();
		lobbyView?.destroy();
		lobbyView = null;
		startGame(detail.room, detail.name, assets);
	});

	lobby.start();
}

function startGame(room, pilotName, assets) {
	const gameChat = createChatPanel({
		mount: document.body,
		connection,
		title: "Чат бою",
		variant: "game-chat",
	});
	gameChat.append(`[система] кімната ${room.id}, пілот ${pilotName}`);
	const game = new Game({
		seed: room.seed ?? 1,
		arena: room.arena ?? assets.arena ?? undefined,
		asteroidTarget: room.asteroidTarget,
		bus,
	});
	game.addPlayer({
		id: "p1",
		name: pilotName,
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

		const scale = Math.min(
			view.width / game.arena.width,
			view.height / game.arena.height,
		);
		ctx.save();
		ctx.translate(
			(view.width - game.arena.width * scale) / 2,
			(view.height - game.arena.height * scale) / 2,
		);
		ctx.scale(scale, scale);
		drawArena(ctx, game.arena);
		for (const kind of DRAW_ORDER) {
			for (const entity of game.world.ofKind(kind)) {
				drawEntity(ctx, entity, alpha, assets.sprites);
			}
		}
		ctx.restore();

		drawScoreboard(ctx, game, view, "p1", hud.scores);
		drawHud(ctx, loop.stats);
	}

	const loop = createLoop({ simulate, render });
	loop.start();
}

void boot();
