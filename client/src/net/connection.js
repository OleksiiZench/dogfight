import { dispatch } from "../events/bus.js";

export function defaultSocketUrl() {
	const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
	return `${protocol}//${window.location.host}/ws${window.location.search}`;
}

function encode(message) {
	return JSON.stringify({ v: 1, ...message });
}

function decode(data) {
	return JSON.parse(data);
}

function byteLength(data) {
	if (typeof data === "string")
		return new TextEncoder().encode(data).byteLength;
	return data?.byteLength ?? data?.length ?? 0;
}

export class Connection extends EventTarget {
	constructor({
		url = defaultSocketUrl(),
		minDelayMs = 500,
		maxDelayMs = 15000,
	} = {}) {
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
		this.tickRate = 30;
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

	connect() {
		if (
			this.socket?.readyState === WebSocket.OPEN ||
			this.socket?.readyState === WebSocket.CONNECTING
		) {
			return;
		}
		this.intentional = false;
		this.open();
	}

	open() {
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

	startPings() {
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

	stopPings() {
		if (this.pingTimer) clearInterval(this.pingTimer);
		this.pingTimer = null;
	}

	scheduleReconnect() {
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

	rawSend(message) {
		const payload = encode(message);
		this.stats.bytesOut += byteLength(payload);
		this.socket?.send(payload);
	}

	send(message, { queue = true } = {}) {
		if (this.socket?.readyState === WebSocket.OPEN) {
			this.rawSend(message);
		} else if (queue) {
			this.queue.push(encode({ v: 1, ...message }));
		}
	}

	sendInput(intent, { seq = ++this.seq, tick = this.tick } = {}) {
		this.seq = Math.max(this.seq, seq);
		this.send(
			{
				type: "input",
				seq,
				tick,
				turn: intent.turn,
				thrust: intent.thrust,
				fire: intent.fire,
			},
			{ queue: false },
		);
	}

	join(room, name) {
		this.joinRequest = { room, name };
		this.roomId = room;
		if (this.socket?.readyState === WebSocket.OPEN) {
			this.rawSend({ type: "join", room, name });
		}
	}

	leave() {
		this.joinRequest = null;
		this.roomId = null;
		this.send({ type: "leave" });
	}

	chat(text) {
		const net = text.match(/^\/net\s+(\d+)\s+(\d+)\s+([0-9.]+)$/);
		if (net) {
			this.send({
				type: "net",
				latencyMs: Number(net[1]),
				jitterMs: Number(net[2]),
				dropRate: Number(net[3]),
			});
			return;
		}
		if (!this.roomId) {
			dispatch(this, "notice", { message: "Спочатку приєднайтеся до кімнати" });
			return;
		}
		this.send({ type: "chat", text });
	}

	close() {
		this.intentional = true;
		this.stopPings();
		if (this.timer) clearTimeout(this.timer);
		this.timer = null;
		if (this.socket?.readyState === WebSocket.OPEN) {
			this.socket.close(1000, "client closed");
		}
	}

	onMessage(event) {
		try {
			this.stats.bytesIn += byteLength(event.data);
			const message = decode(event.data);
			if (!message || typeof message !== "object") return;
			this.lastTick = message.tick ?? this.lastTick;
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
			dispatch(this, message.type ?? "notice", message);
		} catch {
			dispatch(this, "notice", { message: "некоректна відповідь сервера" });
		}
	}
}
