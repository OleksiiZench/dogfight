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
import { MatchView } from "./net/match.js";
import { Predictor } from "./net/predictor.js";
import { setupCanvas } from "./render/canvas.js";
import {
	drawArena,
	drawHud,
	drawNetgraph,
	drawScoreboard,
} from "./render/draw.js";
import { createSprites } from "./render/sprites.js";
import { createChatPanel } from "./ui/chatView.js";
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
		startGame(detail.room, detail.name, assets, detail.player?.id);
	});

	lobby.start();
}

function startGame(room, pilotName, assets, localId = "p1") {
	const gameChat = createChatPanel({
		mount: document.body,
		connection,
		title: "Чат бою",
		variant: "game-chat",
	});
	gameChat.append(`[система] кімната ${room.id}, пілот ${pilotName}`);

	const matchView = new MatchView({
		arena: room.arena ?? assets.arena,
		interpolationDelayMs: Number(params.get("interp") ?? 66),
	});
	const predictor = new Predictor({
		arena: room.arena ?? assets.arena,
		localId,
		stepSeconds: 1 / connection.tickRate,
	});
	let pointerFire = false;
	const onPointerDown = () => {
		pointerFire = true;
		setTimeout(() => {
			pointerFire = false;
		}, 120);
	};
	const onKeyDown = (event) => {
		if (event.code !== "BracketLeft" && event.code !== "BracketRight") return;
		const next =
			matchView.interpolationDelayMs +
			(event.code === "BracketRight" ? 16 : -16);
		matchView.setInterpolationDelay(next);
		gameChat.append(
			`[мережа] інтерполяція ${matchView.interpolationDelayMs} мс`,
		);
	};
	canvas.addEventListener("pointerdown", onPointerDown);
	window.addEventListener("keydown", onKeyDown);

	const onSnapshot = (event) => {
		if (!matchView.applySnapshot(event.detail)) return;
		predictor.reconcile(event.detail, connection);
		matchView.excludeId = predictor.shipId;
		matchView.excludeOwnerId = localId;
	};
	const onNetState = (event) => {
		const { latencyMs, jitterMs, dropRate } = event.detail.net;
		gameChat.append(
			`[мережа] затримка ${latencyMs} мс · джиттер ${jitterMs} мс · втрати ${(dropRate * 100).toFixed(1)}%`,
		);
	};
	connection.addEventListener("snapshot", onSnapshot);
	connection.addEventListener("netState", onNetState);

	function simulate(dt) {
		predictor.stepSeconds = dt;
		const intent = keyboardIntent(input);
		if (pointerFire) intent.fire = true;
		const record = predictor.applyIntent(intent);
		connection.sendInput(intent, record);
		input.endStep();
	}

	function render(alpha) {
		predictor.updateVisual();
		const age = connection.stats.lastSnapshotAt
			? performance.now() - connection.stats.lastSnapshotAt
			: 0;
		const stats = {
			...connection.stats,
			snapshotAgeMs: age,
			interpolationDelayMs: matchView.interpolationDelayMs,
			tick: matchView.tick,
		};
		ctx.clearRect(0, 0, view.width, view.height);

		const scale = Math.min(
			view.width / matchView.arena.width,
			view.height / matchView.arena.height,
		);
		ctx.save();
		ctx.translate(
			(view.width - matchView.arena.width * scale) / 2,
			(view.height - matchView.arena.height * scale) / 2,
		);
		ctx.scale(scale, scale);
		drawArena(ctx, matchView.arena);
		matchView.draw(ctx, alpha, assets.sprites);
		predictor.draw(ctx, alpha, assets.sprites);
		ctx.restore();

		drawScoreboard(
			ctx,
			{ players: matchView.players, arena: matchView.arena },
			view,
			localId,
			matchView.scores,
		);
		drawHud(ctx, loop.stats);
		drawNetgraph(ctx, view, stats);
	}

	const loop = createLoop({
		step: 1 / connection.tickRate,
		simulate,
		render,
	});
	if (params.has("debug")) {
		window.__dogfight = { connection, matchView, predictor, loop };
	}
	loop.start();
}

void boot();
