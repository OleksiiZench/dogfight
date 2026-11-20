import { EventEmitter } from "node:events";
import { performance } from "node:perf_hooks";
import { beginProfile, endProfile } from "shared/profile.ts";
import { intentOf } from "shared/protocol/input.ts";
import type { SnapshotMessage } from "shared/protocol/schema.ts";
import { Game } from "shared/sim/game.ts";
import type {
	EntityId,
	GameEvent,
	InputFields,
	Intent,
	PlayerId,
	Seq,
	Snapshot,
	Tick,
} from "shared/types.ts";
import { asSeq, asTick } from "shared/types.ts";
import { type Bot, createBots } from "./bots.ts";
import type { Room, RoomPlayer } from "./rooms.ts";

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

interface MatchStats {
	ticks: number;
	durations: number[];
	jitter: number[];
	lastDuration: number;
	lastJitter: number;
	previousTick: number | null;
}

export interface MatchStatsSummary {
	id: string;
	tick: Tick;
	tickRate: number;
	ticks: number;
	meanDurationMs: number;
	p95DurationMs: number;
	p99DurationMs: number;
	maxDurationMs: number;
	meanJitterMs: number;
	p99JitterMs: number;
	maxJitterMs: number;
	players: number;
	bots: number;
}

export interface MatchEvents {
	tick: [snapshot: Snapshot];
}

export class Match extends EventEmitter<MatchEvents> {
	readonly room: Room;
	readonly stepSeconds: number;
	readonly intervalMs: number;
	readonly game: Game;
	tick: Tick;
	inputs: Map<PlayerId, Intent>;
	lastSeq: Map<PlayerId, Seq>;
	snapshot: Snapshot;
	events: GameEvent[];
	timer: NodeJS.Timeout | null;
	nextTick: number;
	stats: MatchStats;
	bots: Bot[];
	maxBots: number;
	onJoin: (player: RoomPlayer) => void;
	onLeave: (player: RoomPlayer) => void;

	constructor(
		room: Room,
		{
			tickRate = 30,
			maxBots = 16,
		}: { tickRate?: number; maxBots?: number } = {},
	) {
		super();
		this.setMaxListeners(0);
		this.room = room;
		this.stepSeconds = 1 / tickRate;
		this.intervalMs = 1000 / tickRate;
		this.maxBots = maxBots;
		this.bots = [];
		this.game = new Game({
			seed: room.seed,
			arena: room.arena,
			asteroidTarget: room.asteroidTarget,
		});
		this.game.start();
		this.tick = asTick(0);
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
		this.onJoin = (player: RoomPlayer): void => this.addPlayer(player);
		this.onLeave = (player: RoomPlayer): void => this.removePlayer(player.id);
		room.on("join", this.onJoin);
		room.on("leave", this.onLeave);
	}

	addPlayer(player: RoomPlayer): void {
		if (this.game.players.has(player.id)) return;
		this.game.addPlayer({
			id: player.id,
			name: player.name,
			color: COLORS[this.game.players.size % COLORS.length] ?? "#4ade80",
		});
	}

	removePlayer(id: PlayerId): void {
		this.game.removePlayer(id);
		this.inputs.delete(id);
		this.lastSeq.delete(id);
	}

	setBots(requested: number): number {
		const count = Math.max(0, Math.min(this.maxBots, Math.trunc(requested)));
		while (this.bots.length > count) {
			const bot = this.bots.pop();
			if (!bot) break;
			this.game.removePlayer(bot.id);
			this.inputs.delete(bot.id);
			this.lastSeq.delete(bot.id);
		}
		const nextBots = createBots(count);
		for (let index = 0; index < nextBots.length; index++) {
			const bot = nextBots[index];
			if (!bot) continue;
			if (this.bots[index]?.id === bot.id) continue;
			const previous = this.bots[index];
			if (previous) this.game.removePlayer(previous.id);
			this.game.addPlayer({
				id: bot.id,
				name: bot.name,
				color: bot.color,
				fireDelay: bot.fireDelay,
			});
			this.bots[index] = bot;
		}
		this.bots.length = count;
		return this.bots.length;
	}

	applyInput(
		playerId: PlayerId,
		input: InputFields & { type?: "input" },
	): boolean {
		const player = this.game.players.get(playerId);
		if (!player?.ship?.alive) return false;
		const previous = this.lastSeq.get(playerId) ?? asSeq(-1);
		if (input.seq <= previous) return false;
		this.lastSeq.set(playerId, asSeq(input.seq));
		this.inputs.set(playerId, intentOf(input));
		return true;
	}

	start(): void {
		if (this.timer) return;
		this.schedule();
	}

	schedule(): void {
		const now = performance.now();
		this.nextTick += this.intervalMs;
		const wait = Math.max(0, this.nextTick - now);
		this.timer = setTimeout(() => this.step(), wait);
	}

	step(): void {
		const token = beginProfile("server:simulate");
		try {
			this.stepInner();
		} finally {
			endProfile(token, "server:simulate");
		}
	}

	stepInner(): void {
		const started = performance.now();
		const intents = new Map<EntityId, Intent>();
		for (const [playerId, input] of this.inputs) {
			const player = this.game.players.get(playerId);
			if (player?.ship?.alive) intents.set(player.ship.id, input);
		}
		this.inputs.clear();
		for (const bot of this.bots) {
			const ship = this.game.players.get(bot.id)?.ship;
			if (ship?.alive) intents.set(ship.id, bot.update(this.game, this.tick));
		}

		const events = this.game.step(this.stepSeconds, intents);
		this.tick = asTick(this.tick + 1);
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

	snapshotFor(playerId: PlayerId): SnapshotMessage {
		return {
			...this.snapshot,
			events: this.events,
			lastProcessedSeq: this.lastSeq.get(playerId) ?? 0,
		};
	}

	getStats(): MatchStatsSummary {
		const mean = (values: readonly number[]): number =>
			values.length
				? values.reduce((sum, value) => sum + value, 0) / values.length
				: 0;
		const max = (values: readonly number[]): number =>
			values.length ? Math.max(...values) : 0;
		const percentile = (
			values: readonly number[],
			fraction: number,
		): number => {
			if (values.length === 0) return 0;
			const sorted = [...values].sort((a, b) => a - b);
			return (
				sorted[
					Math.min(sorted.length - 1, Math.ceil(fraction * sorted.length) - 1)
				] ?? 0
			);
		};
		return {
			id: this.room.id,
			tick: this.tick,
			tickRate: Math.round(1 / this.stepSeconds),
			ticks: this.stats.ticks,
			meanDurationMs: mean(this.stats.durations),
			p95DurationMs: percentile(this.stats.durations, 0.95),
			p99DurationMs: percentile(this.stats.durations, 0.99),
			maxDurationMs: max(this.stats.durations),
			meanJitterMs: mean(this.stats.jitter),
			p99JitterMs: percentile(this.stats.jitter, 0.99),
			maxJitterMs: max(this.stats.jitter),
			players: this.game.players.size,
			bots: this.bots.length,
		};
	}

	close(): void {
		if (this.timer) clearTimeout(this.timer);
		this.timer = null;
		this.room.off("join", this.onJoin);
		this.room.off("leave", this.onLeave);
	}
}
