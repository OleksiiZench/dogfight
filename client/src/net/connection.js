import { dispatch } from "../events/bus.js";

export function defaultSocketUrl() {
	const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
	return `${protocol}//${window.location.host}/ws`;
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
		this.intentional = false;
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
		this.socket = socket;
		dispatch(this, "connecting", { attempt: this.attempt });

		socket.addEventListener("open", () => {
			this.attempt = 0;
			dispatch(this, "open");
			const queued = this.queue.splice(0);
			for (const payload of queued) socket.send(payload);
			if (this.joinRequest) {
				socket.send(
					JSON.stringify({ v: 1, type: "join", ...this.joinRequest }),
				);
			}
		});

		socket.addEventListener("message", (event) => this.onMessage(event));
		socket.addEventListener("error", () =>
			dispatch(this, "error", { message: "socket error" }),
		);
		socket.addEventListener("close", (event) => {
			if (this.socket === socket) this.socket = null;
			dispatch(this, "closed", {
				code: event.code,
				reason: event.reason,
				wasClean: event.wasClean,
			});
			if (!this.intentional) this.scheduleReconnect();
		});
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
		this.socket?.send(JSON.stringify({ v: 1, ...message }));
	}

	send(message) {
		if (this.socket?.readyState === WebSocket.OPEN) this.rawSend(message);
		else this.queue.push(JSON.stringify({ v: 1, ...message }));
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
		if (!this.roomId) {
			dispatch(this, "notice", { message: "Спочатку приєднайтеся до кімнати" });
			return;
		}
		this.send({ type: "chat", text });
	}

	close() {
		this.intentional = true;
		if (this.timer) clearTimeout(this.timer);
		this.timer = null;
		if (this.socket?.readyState === WebSocket.OPEN) {
			this.socket.close(1000, "client closed");
		}
	}

	onMessage(event) {
		try {
			const message = JSON.parse(event.data);
			if (!message || typeof message !== "object") return;
			dispatch(this, message.type ?? "notice", message);
		} catch {
			dispatch(this, "notice", { message: "некоректна відповідь сервера" });
		}
	}
}
