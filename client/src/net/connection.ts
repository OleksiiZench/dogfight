import { measureProfile } from "shared/profile.ts";
import type { ClientMessage, ServerMessage } from "shared/protocol.ts";
import {
	encodeMessage,
	parseBinaryServerMessage,
	parseServerMessage,
} from "shared/protocol.ts";
import type {
	BinarySource,
	CodecName,
	Intent,
	WirePayload,
} from "shared/types.ts";
import { asSeq, asTick } from "shared/types.ts";
import { dispatch } from "../events/bus.ts";

export function defaultSocketUrl(): string {
	const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
	return `${protocol}//${window.location.host}/ws${window.location.search}`;
}

function encode(
	message: ClientMessage,
	codec: CodecName = "json",
): WirePayload {
	return encodeMessage(message, codec);
}

function decodeServerMessage(data: unknown): ServerMessage | null {
	return measureProfile("decode", () => {
		if (typeof data === "string") {
			const result = parseServerMessage(data);
			return result.ok ? result.value : null;
		}
		if (data instanceof ArrayBuffer || ArrayBuffer.isView(data)) {
			const source: BinarySource = data;
			const result = parseBinaryServerMessage(source);
			if (!result.ok || result.value.type !== "snapshot") return null;
			return result.value;
		}
		return null;
	});
}

function byteLength(data: unknown): number {
	if (typeof data === "string")
		return new TextEncoder().encode(data).byteLength;
	if (data instanceof ArrayBuffer) return data.byteLength;
	if (ArrayBuffer.isView(data)) return data.byteLength;
	if (typeof data === "object" && data !== null) {
		if ("byteLength" in data && typeof data.byteLength === "number")
			return data.byteLength;
		if ("length" in data && typeof data.length === "number") return data.length;
	}
	return 0;
}

export interface ConnectionStats {
	rttMs: number;
	bytesIn: number;
	bytesOut: number;
	bytesInPerSec: number;
	bytesOutPerSec: number;
	snapshots: number;
	lastSnapshotAt: number;
	snapshotAgeMs: number;
	pendingInputs: number;
	correction: number;
	interpolationDelayMs: number;
}

export interface ConnectionOptions {
	url?: string;
	minDelayMs?: number;
	maxDelayMs?: number;
}

export interface JoinRequest {
	room: string;
	name: string;
	codec: CodecName;
}

export class Connection extends EventTarget {
	url: string;
	minDelayMs: number;
	maxDelayMs: number;
	socket: WebSocket | null;
	queue: WirePayload[];
	joinRequest: JoinRequest | null;
	roomId: string | null;
	attempt: number;
	timer: ReturnType<typeof setTimeout> | null;
	pingTimer: ReturnType<typeof setInterval> | null;
	intentional: boolean;
	seq: number;
	tick: number;
	lastTick: number;
	tickRate: number;
	codec: CodecName;
	rateWindow: { at: number; bytesIn: number; bytesOut: number };
	stats: ConnectionStats;

	constructor({
		url = defaultSocketUrl(),
		minDelayMs = 500,
		maxDelayMs = 15000,
	}: ConnectionOptions = {}) {
		super();
		this.url = url;
		this.minDelayMs = minDelayMs;
		this.maxDelayMs = maxDelayMs;
		this.socket = null;
		this.queue = [];
		this.joinRequest = null;
		this.roomId = null;
		this.attempt = 0;
		this.timer = null;
		this.pingTimer = null;
		this.intentional = false;
		this.seq = 0;
		this.tick = 0;
		this.lastTick = 0;
		this.tickRate = 30;
		this.codec =
			new URLSearchParams(window.location.search).get("codec") === "json"
				? "json"
				: "binary";
		this.rateWindow = { at: performance.now(), bytesIn: 0, bytesOut: 0 };
		this.stats = {
			rttMs: 0,
			bytesIn: 0,
			bytesOut: 0,
			bytesInPerSec: 0,
			bytesOutPerSec: 0,
			snapshots: 0,
			lastSnapshotAt: 0,
			snapshotAgeMs: 0,
			pendingInputs: 0,
			correction: 0,
			interpolationDelayMs: 66,
		};
	}

	connect(): void {
		if (
			this.socket?.readyState === WebSocket.OPEN ||
			this.socket?.readyState === WebSocket.CONNECTING
		) {
			return;
		}
		this.intentional = false;
		this.open();
	}

	open(): void {
		const socket = new WebSocket(this.url);
		socket.binaryType = "arraybuffer";
		this.socket = socket;
		dispatch(this, "connecting", { attempt: this.attempt });

		socket.addEventListener("open", () => {
			this.attempt = 0;
			dispatch(this, "open");
			const queued = this.queue.splice(0);
			for (const payload of queued) socket.send(payload);
			if (this.joinRequest)
				socket.send(encode({ type: "join", ...this.joinRequest }));
			this.startPings();
		});

		socket.addEventListener("message", (event) => this.onMessage(event));
		socket.addEventListener("error", () =>
			dispatch(this, "error", { message: "socket error" }),
		);
		socket.addEventListener("close", (event) => {
			this.stopPings();
			if (this.socket === socket) this.socket = null;
			dispatch(this, "closed", {
				code: event.code,
				reason: event.reason,
				wasClean: event.wasClean,
			});
			if (!this.intentional) this.scheduleReconnect();
		});
	}

	startPings(): void {
		this.stopPings();
		this.pingTimer = setInterval(() => {
			const now = performance.now();
			const seconds = (now - this.rateWindow.at) / 1000;
			if (seconds > 0) {
				this.stats.bytesInPerSec =
					(this.stats.bytesIn - this.rateWindow.bytesIn) / seconds;
				this.stats.bytesOutPerSec =
					(this.stats.bytesOut - this.rateWindow.bytesOut) / seconds;
			}
			this.rateWindow = {
				at: now,
				bytesIn: this.stats.bytesIn,
				bytesOut: this.stats.bytesOut,
			};
			this.send({ type: "ping", t: performance.now() }, { queue: false });
		}, 1000);
	}

	stopPings(): void {
		if (this.pingTimer) clearInterval(this.pingTimer);
		this.pingTimer = null;
	}

	scheduleReconnect(): void {
		if (this.timer) return;
		const exponential = this.minDelayMs * 2 ** Math.min(this.attempt, 10);
		const delay =
			Math.min(this.maxDelayMs, exponential) + Math.round(Math.random() * 250);
		this.attempt += 1;
		dispatch(this, "reconnecting", { attempt: this.attempt, delay });
		this.timer = setTimeout(() => {
			this.timer = null;
			this.open();
		}, delay);
	}

	rawSend(message: ClientMessage): void {
		const payload = encode(message, this.codec);
		this.stats.bytesOut += byteLength(payload);
		this.socket?.send(payload);
	}

	send(
		message: ClientMessage,
		{ queue = true }: { queue?: boolean } = {},
	): void {
		if (this.socket?.readyState === WebSocket.OPEN) {
			this.rawSend(message);
		} else if (queue) {
			this.queue.push(encode(message, this.codec));
		}
	}

	sendInput(
		intent: Intent,
		{
			seq = ++this.seq,
			tick = this.tick,
		}: { seq?: number; tick?: number } = {},
	): void {
		this.seq = Math.max(this.seq, seq);
		this.send(
			{
				type: "input",
				seq: asSeq(seq),
				tick: asTick(tick),
				turn: intent.turn,
				thrust: intent.thrust,
				fire: intent.fire,
			},
			{ queue: false },
		);
	}

	join(room: string, name: string): void {
		this.joinRequest = { room, name, codec: this.codec };
		this.roomId = room;
		if (this.socket?.readyState === WebSocket.OPEN) {
			this.rawSend({ type: "join", ...this.joinRequest });
		}
	}

	leave(): void {
		this.joinRequest = null;
		this.roomId = null;
		this.send({ type: "leave" });
	}

	chat(text: string): void {
		const net = text.match(/^\/net\s+(\d+)\s+(\d+)\s+([0-9.]+)$/);
		if (net) {
			const latencyMs = net[1];
			const jitterMs = net[2];
			const dropRate = net[3];
			if (latencyMs && jitterMs && dropRate) {
				this.send({
					type: "net",
					latencyMs: Number(latencyMs),
					jitterMs: Number(jitterMs),
					dropRate: Number(dropRate),
				});
			}
			return;
		}
		if (!this.roomId) {
			dispatch(this, "notice", { message: "Спочатку приєднайтеся до кімнати" });
			return;
		}
		this.send({ type: "chat", text });
	}

	close(): void {
		this.intentional = true;
		this.stopPings();
		if (this.timer) clearTimeout(this.timer);
		this.timer = null;
		if (this.socket?.readyState === WebSocket.OPEN) {
			this.socket.close(1000, "client closed");
		}
	}

	onMessage(event: MessageEvent<unknown>): void {
		try {
			this.stats.bytesIn += byteLength(event.data);
			const message = decodeServerMessage(event.data);
			if (!message) {
				dispatch(this, "notice", { message: "некоректна відповідь сервера" });
				return;
			}
			if (message.type === "snapshot") this.lastTick = message.tick;
			if (message.type === "hello" || message.type === "welcome") {
				this.tickRate = Number(message.tickRate) || this.tickRate;
			}
			if (message.type === "snapshot") {
				this.stats.snapshots += 1;
				this.stats.lastSnapshotAt = performance.now();
			}
			if (message.type === "pong") {
				this.stats.rttMs = performance.now() - Number(message.t);
			}
			dispatch(this, message.type, message);
		} catch {
			dispatch(this, "notice", { message: "некоректна відповідь сервера" });
		}
	}
}
