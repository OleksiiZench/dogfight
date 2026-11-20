import { EventEmitter } from "node:events";
import { performance } from "node:perf_hooks";
import { intentOf } from "shared/protocol/input.js";
import { Game } from "shared/sim/game.js";

const COLORS = [
	"#4ade80",
	"#f87171",
	"#60a5fa",
	"#facc15",
	"#c084fc",
	"#2dd4bf",
	"#fb923c",
	"#e879f9",
];

const LOGGED_EVENTS = new Set([
	"shipDestroyed",
	"asteroidDestroyed",
	"pickup",
	"scoreChanged",
]);

export class Match extends EventEmitter {
	constructor(room, { tickRate = 30 } = {}) {
		super();
		this.room = room;
		this.stepSeconds = 1 / tickRate;
		this.intervalMs = 1000 / tickRate;
		this.game = new Game({
			seed: room.seed,
			arena: room.arena,
			asteroidTarget: room.asteroidTarget,
		});
		this.game.start();
		this.tick = 0;
		this.inputs = new Map();
		this.lastSeq = new Map();
		this.snapshot = this.game.snapshot(this.tick);
		this.events = [];
		this.timer = null;
		this.nextTick = performance.now() + this.intervalMs;
		this.stats = {
			ticks: 0,
			durations: [],
			jitter: [],
			lastDuration: 0,
			lastJitter: 0,
			previousTick: null,
		};
		this.onJoin = (player) => this.addPlayer(player);
		this.onLeave = (player) => this.removePlayer(player.id);
		room.on("join", this.onJoin);
		room.on("leave", this.onLeave);
	}

	addPlayer(player) {
		if (this.game.players.has(player.id)) return;
		this.game.addPlayer({
			id: player.id,
			name: player.name,
			color: COLORS[this.game.players.size % COLORS.length],
		});
	}

	removePlayer(id) {
		this.game.removePlayer(id);
		this.inputs.delete(id);
		this.lastSeq.delete(id);
	}

	applyInput(playerId, input) {
		const player = this.game.players.get(playerId);
		if (!player?.ship?.alive) return false;
		const previous = this.lastSeq.get(playerId) ?? -1;
		if (input.seq <= previous) return false;
		this.lastSeq.set(playerId, input.seq);
		this.inputs.set(playerId, intentOf(input));
		return true;
	}

	start() {
		if (this.timer) return;
		this.schedule();
	}

	schedule() {
		const now = performance.now();
		this.nextTick += this.intervalMs;
		const wait = Math.max(0, this.nextTick - now);
		this.timer = setTimeout(() => this.step(), wait);
	}

	step() {
		const started = performance.now();
		const intents = new Map();
		for (const [playerId, input] of this.inputs) {
			const player = this.game.players.get(playerId);
			if (player?.ship?.alive) intents.set(player.ship.id, input);
		}
		this.inputs.clear();

		const events = this.game.step(this.stepSeconds, intents);
		this.tick += 1;
		for (const event of events) {
			if (LOGGED_EVENTS.has(event.type))
				this.room.record(event.type, { game: event });
		}
		this.events = events;
		this.snapshot = this.game.snapshot(this.tick);
		this.emit("tick", this.snapshot);

		const duration = performance.now() - started;
		const jitter =
			this.stats.previousTick === null
				? 0
				: Math.abs(started - this.stats.previousTick - this.intervalMs);
		this.stats.previousTick = started;
		this.stats.lastDuration = duration;
		this.stats.lastJitter = jitter;
		this.stats.ticks += 1;
		this.stats.durations.push(duration);
		this.stats.jitter.push(jitter);
		if (this.stats.durations.length > 120) this.stats.durations.shift();
		if (this.stats.jitter.length > 120) this.stats.jitter.shift();
		this.schedule();
	}

	snapshotFor(playerId) {
		return {
			...this.snapshot,
			events: this.events,
			lastProcessedSeq: this.lastSeq.get(playerId) ?? 0,
		};
	}

	getStats() {
		const mean = (values) =>
			values.length
				? values.reduce((sum, value) => sum + value, 0) / values.length
				: 0;
		const max = (values) => (values.length ? Math.max(...values) : 0);
		return {
			id: this.room.id,
			tick: this.tick,
			tickRate: Math.round(1 / this.stepSeconds),
			ticks: this.stats.ticks,
			meanDurationMs: mean(this.stats.durations),
			maxDurationMs: max(this.stats.durations),
			meanJitterMs: mean(this.stats.jitter),
			maxJitterMs: max(this.stats.jitter),
			players: this.game.players.size,
		};
	}

	close() {
		if (this.timer) clearTimeout(this.timer);
		this.timer = null;
		this.room.off("join", this.onJoin);
		this.room.off("leave", this.onLeave);
	}
}
