import {
	clearProfileMeasures,
	measureProfile,
	profileMeasures,
	setProfileEnabled,
} from "shared/profile.ts";
import type { NetSettings } from "shared/protocol.ts";
import type { Arena, PlayerId, Snapshot } from "shared/types.ts";
import "./style.css";
import type { AssetManifest, LoadedAssets, LoadJob } from "./assets/loader.ts";
import {
	fetchJson,
	isCancellation,
	loadAll,
	loadJson,
} from "./assets/loader.ts";
import { attachAudio, createAudio } from "./audio/audio.ts";
import { keyboardIntent } from "./controls.ts";
import { createBus, detailOf } from "./events/bus.ts";
import { createInput } from "./input.ts";
import { createLoop } from "./loop.ts";
import { Connection } from "./net/connection.ts";
import type { JoinedInfo, LobbyRoom } from "./net/lobby.ts";
import { Lobby } from "./net/lobby.ts";
import { MatchView } from "./net/match.ts";
import { Predictor } from "./net/predictor.ts";
import { setupCanvas } from "./render/canvas.ts";
import {
	drawArena,
	drawHud,
	drawNetgraph,
	drawScoreboard,
} from "./render/draw.ts";
import type { Sprites } from "./render/sprites.ts";
import { createSprites } from "./render/sprites.ts";
import { createChatPanel } from "./ui/chatView.ts";
import { errorMessage } from "./ui/dom.ts";
import type { LoadingFailure, LoadingScreen } from "./ui/loading.ts";
import { createLoadingScreen } from "./ui/loading.ts";
import type { LobbyView } from "./ui/lobbyView.ts";
import { createLobbyView } from "./ui/lobbyView.ts";

const MANIFEST_URL = "/assets/manifest.json";
const params = new URLSearchParams(window.location.search);
setProfileEnabled(params.has("profile"));
const gameCanvas = document.getElementById("game");
if (!(gameCanvas instanceof HTMLCanvasElement))
	throw new Error("missing #game canvas");
const canvas = gameCanvas;
const { ctx, view } = setupCanvas(canvas);
const input = createInput(window);
const bus = createBus();
const audio = createAudio();
const connection = new Connection();
attachAudio(bus, audio);

let bootController: AbortController | null = null;
let loading: LoadingScreen | null = null;
let lobbyView: LobbyView | null = null;

const isRecord = (value: unknown): value is Record<string, unknown> =>
	typeof value === "object" && value !== null && !Array.isArray(value);

function isStringRecord(value: unknown): value is Record<string, string> {
	return (
		isRecord(value) &&
		Object.values(value).every(
			(entry): entry is string => typeof entry === "string",
		)
	);
}

function parseManifest(raw: unknown): AssetManifest {
	if (!isRecord(raw)) throw new TypeError("invalid asset manifest");
	return {
		sprites: isStringRecord(raw.sprites) ? raw.sprites : undefined,
		sounds: isStringRecord(raw.sounds) ? raw.sounds : undefined,
		arena: typeof raw.arena === "string" ? raw.arena : undefined,
		rooms: typeof raw.rooms === "string" ? raw.rooms : undefined,
	};
}

function parseArena(value: unknown): Arena | null {
	if (
		!isRecord(value) ||
		typeof value.width !== "number" ||
		!Number.isFinite(value.width) ||
		typeof value.height !== "number" ||
		!Number.isFinite(value.height)
	) {
		return null;
	}
	return { width: value.width, height: value.height };
}

function debugManifest(raw: unknown): AssetManifest {
	const manifest = parseManifest(raw);
	const copy: AssetManifest = structuredClone(manifest);
	const failure = params.get("fail");
	if (failure === "404" && copy.sprites) copy.sprites.sheet = "/debug/404";
	if (failure === "json") copy.arena = "/debug/badjson";
	return copy;
}

function debugJobs(): LoadJob[] {
	if (!bootController) throw new Error("boot controller is unavailable");
	const jobs: LoadJob[] = [];
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
	const failures: LoadingFailure[] = [];

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
		const assets: LoadedAssets = await loadAll(manifest, {
			ctx: audio.context,
			signal,
			extra: debugJobs(),
			sequential: params.get("sequential") === "1",
			onProgress: ({ done, total, name, error }) => {
				if (error) failures.push({ name, error });
				loading?.setState({ done, total, name });
			},
		});
		const elapsed = performance.now() - started;
		const mode = params.get("sequential") === "1" ? "sequential" : "concurrent";
		console.log(`[loadAll] ${mode}: ${elapsed.toFixed(0)} ms`);

		for (const [name, buffer] of Object.entries(assets.sounds)) {
			if (buffer instanceof AudioBuffer) audio.set(name, buffer);
		}

		loading.dispose();
		loading = null;
		showLobby(manifest.rooms ?? "/api/rooms", {
			arena: parseArena(assets.arena),
			sprites: createSprites(assets.sprites.sheet),
		});
	} catch (error) {
		console.error("[loading]", error);
		loading?.setState({
			phase: isCancellation(error) ? "cancelled" : "error",
			message: errorMessage(error),
		});
	}
}

interface GameAssets {
	arena: Arena | null;
	sprites: Sprites | null;
}

function showLobby(roomsUrl: string, assets: GameAssets) {
	const lobby = new Lobby({ url: roomsUrl, connection });
	lobbyView = createLobbyView({ mount: document.body, lobby });

	lobby.addEventListener("joined", (event) => {
		const detail = detailOf<JoinedInfo>(event);
		void audio.unlock();
		console.log(`[lobby] ${detail.name} → ${detail.room.id}`);
	});

	lobby.addEventListener("start", (event) => {
		const detail = detailOf<JoinedInfo>(event);
		lobby.detach();
		lobbyView?.destroy();
		lobbyView = null;
		startGame(detail.room, detail.name, assets, detail.player?.id);
	});

	lobby.start();
}

function startGame(
	room: LobbyRoom,
	pilotName: string,
	assets: GameAssets,
	localId: PlayerId = "p1",
) {
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
	const onKeyDown = (event: KeyboardEvent) => {
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

	const onSnapshot = (event: Event) => {
		const snapshot = detailOf<Snapshot>(event);
		if (!matchView.applySnapshot(snapshot)) return;
		predictor.reconcile(snapshot, connection);
		matchView.excludeId = predictor.shipId;
		matchView.excludeOwnerId = localId;
	};
	const onNetState = (event: Event) => {
		const { latencyMs, jitterMs, dropRate } = detailOf<{ net: NetSettings }>(
			event,
		).net;
		gameChat.append(
			`[мережа] затримка ${latencyMs} мс · джиттер ${jitterMs} мс · втрати ${(dropRate * 100).toFixed(1)}%`,
		);
	};
	connection.addEventListener("snapshot", onSnapshot);
	connection.addEventListener("netState", onNetState);

	function simulate(dt: number) {
		measureProfile("simulate", () => {
			predictor.stepSeconds = dt;
			const intent = keyboardIntent(input);
			if (pointerFire) intent.fire = true;
			const record = predictor.applyIntent(intent);
			connection.sendInput(intent, record);
			input.endStep();
		});
	}

	function render(alpha: number) {
		measureProfile("render", () => {
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
		});
	}

	const loop = createLoop({
		step: 1 / connection.tickRate,
		simulate,
		render,
	});
	if (params.has("debug")) {
		window.__dogfight = {
			connection,
			matchView,
			predictor,
			loop,
			profile: { measures: profileMeasures, clear: clearProfileMeasures },
		};
	}
	loop.start();
}

void boot();
