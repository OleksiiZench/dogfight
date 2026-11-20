import { performance } from "node:perf_hooks";
import { Counter, Gauge, Registry } from "prom-client";

export const REJECTION_REASONS = [
	"origin",
	"ip_limit",
	"payload",
	"rate_limit",
	"join_timeout",
	"slow_client",
	"policy",
] as const;

export type RejectionReason = (typeof REJECTION_REASONS)[number];

export function emptyRejectionCounts(): Record<RejectionReason, number> {
	return {
		origin: 0,
		ip_limit: 0,
		payload: 0,
		rate_limit: 0,
		join_timeout: 0,
		slow_client: 0,
		policy: 0,
	};
}

export interface TickMetric {
	room: string;
	p99DurationMs: number;
}

export interface Metrics {
	readonly contentType: string;
	setBuild(version: string): void;
	setResources(rooms: number, players: number, wsClients: number): void;
	setTicks(ticks: readonly TickMetric[]): void;
	incMessages(direction: "in" | "out"): void;
	addBytes(direction: "in" | "out", bytes: number): void;
	incRejection(reason: RejectionReason): void;
	text(): Promise<string>;
	snapshot(): Record<string, unknown>;
}

export function createMetrics(): Metrics {
	const registry = new Registry();
	const build = new Gauge({
		name: "dogfight_build_info",
		help: "Running build version",
		labelNames: ["version"],
		registers: [registry],
	});
	const rooms = new Gauge({
		name: "dogfight_rooms",
		help: "Number of active rooms",
		registers: [registry],
	});
	const players = new Gauge({
		name: "dogfight_players",
		help: "Number of connected players",
		registers: [registry],
	});
	const wsClients = new Gauge({
		name: "dogfight_ws_clients",
		help: "Number of open WebSocket connections",
		registers: [registry],
	});
	const tickP99 = new Gauge({
		name: "dogfight_tick_duration_p99_ms",
		help: "Simulation tick duration p99 in milliseconds",
		labelNames: ["room"],
		registers: [registry],
	});
	const messages = new Counter({
		name: "dogfight_messages_total",
		help: "WebSocket messages processed",
		labelNames: ["direction"],
		registers: [registry],
	});
	const bytes = new Counter({
		name: "dogfight_bytes_total",
		help: "WebSocket payload bytes",
		labelNames: ["direction"],
		registers: [registry],
	});
	const rejections = new Counter({
		name: "dogfight_rejections_total",
		help: "Rejected connections and messages by reason",
		labelNames: ["reason"],
		registers: [registry],
	});
	const eventLoopUtilization = new Gauge({
		name: "dogfight_event_loop_utilization",
		help: "Node.js event loop utilization ratio",
		registers: [registry],
	});
	const residentMemory = new Gauge({
		name: "dogfight_process_resident_memory_bytes",
		help: "Resident set size in bytes",
		registers: [registry],
	});

	for (const reason of REJECTION_REASONS) rejections.inc({ reason }, 0);

	const state: {
		messagesIn: number;
		messagesOut: number;
		bytesIn: number;
		bytesOut: number;
		rejections: Record<RejectionReason, number>;
		rooms: number;
		players: number;
		wsClients: number;
		ticks: TickMetric[];
		eventLoopUtilization: number;
		rss: number;
	} = {
		messagesIn: 0,
		messagesOut: 0,
		bytesIn: 0,
		bytesOut: 0,
		rejections: emptyRejectionCounts(),
		rooms: 0,
		players: 0,
		wsClients: 0,
		ticks: [],
		eventLoopUtilization: 0,
		rss: 0,
	};

	let previousElu = performance.eventLoopUtilization();
	let tickRooms = new Set<string>();

	function sample(): void {
		const nextElu = performance.eventLoopUtilization(previousElu);
		previousElu = nextElu;
		state.eventLoopUtilization = nextElu.utilization;
		state.rss = process.memoryUsage().rss;
		eventLoopUtilization.set(nextElu.utilization);
		residentMemory.set(state.rss);
	}

	return {
		contentType: registry.contentType,
		setBuild(version) {
			build.set({ version }, 1);
		},
		setResources(roomCount, playerCount, clientCount) {
			state.rooms = roomCount;
			state.players = playerCount;
			state.wsClients = clientCount;
			rooms.set(roomCount);
			players.set(playerCount);
			wsClients.set(clientCount);
		},
		setTicks(values) {
			const nextRooms = new Set(values.map((value) => value.room));
			for (const room of tickRooms) {
				if (!nextRooms.has(room)) tickP99.remove({ room });
			}
			for (const value of values)
				tickP99.set({ room: value.room }, value.p99DurationMs);
			tickRooms = nextRooms;
			state.ticks = [...values];
		},
		incMessages(direction) {
			messages.inc({ direction });
			if (direction === "in") state.messagesIn += 1;
			else state.messagesOut += 1;
		},
		addBytes(direction, amount) {
			bytes.inc({ direction }, amount);
			if (direction === "in") state.bytesIn += amount;
			else state.bytesOut += amount;
		},
		incRejection(reason) {
			rejections.inc({ reason });
			state.rejections[reason] = (state.rejections[reason] ?? 0) + 1;
		},
		async text() {
			sample();
			return registry.metrics();
		},
		snapshot() {
			sample();
			return {
				rooms: state.rooms,
				players: state.players,
				wsClients: state.wsClients,
				messages: { in: state.messagesIn, out: state.messagesOut },
				bytes: { in: state.bytesIn, out: state.bytesOut },
				rejections: { ...state.rejections },
				ticks: state.ticks.map((tick) => ({ ...tick })),
				eventLoopUtilization: state.eventLoopUtilization,
				rss: state.rss,
			};
		},
	};
}
