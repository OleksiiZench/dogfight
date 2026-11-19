import { fetchJson, isCancellation } from "../assets/loader.js";
import { dispatch } from "../events/bus.js";

export class Lobby extends EventTarget {
	#rooms = [];
	#controller = null;
	#timer = 0;
	#joined = null;
	#listeners = [];

	constructor({
		url = "/api/rooms",
		pollMs = 4000,
		timeoutMs = 6000,
		connection = null,
	} = {}) {
		super();
		this.url = url;
		this.pollMs = pollMs;
		this.timeoutMs = timeoutMs;
		this.connection = connection;
		if (connection) this.#bindConnection();
	}

	get rooms() {
		return [...this.#rooms];
	}

	get joined() {
		return this.#joined ? { ...this.#joined } : null;
	}

	#on(target, type, handler) {
		target.addEventListener(type, handler);
		this.#listeners.push([target, type, handler]);
	}

	#bindConnection() {
		this.#on(this.connection, "open", () =>
			dispatch(this, "connectionState", { state: "connected" }),
		);
		this.#on(this.connection, "connecting", (event) =>
			dispatch(this, "connectionState", {
				state: "connecting",
				attempt: event.detail.attempt,
			}),
		);
		this.#on(this.connection, "reconnecting", (event) =>
			dispatch(this, "connectionState", {
				state: "reconnecting",
				...event.detail,
			}),
		);
		this.#on(this.connection, "closed", (event) =>
			dispatch(this, "connectionState", { state: "closed", ...event.detail }),
		);
		this.#on(this.connection, "welcome", (event) => {
			const known = this.#rooms.find(
				(room) => room.id === event.detail.room?.id,
			);
			this.#joined = {
				room: { ...known, ...event.detail.room },
				name: event.detail.player.name,
				player: event.detail.player,
			};
			dispatch(this, "joined", this.joined);
		});
		this.#on(this.connection, "roster", (event) =>
			dispatch(this, "roster", event.detail),
		);
		this.#on(this.connection, "chat", (event) =>
			dispatch(this, "chat", event.detail),
		);
		this.#on(this.connection, "notice", (event) =>
			dispatch(this, "notice", event.detail),
		);
		this.#on(this.connection, "error", () =>
			dispatch(this, "connectionState", { state: "error" }),
		);
	}

	async refresh() {
		this.#controller ??= new AbortController();
		const signal = AbortSignal.any([
			this.#controller.signal,
			AbortSignal.timeout(this.timeoutMs),
		]);
		dispatch(this, "refreshing");

		try {
			const rooms = await fetchJson(this.url, { signal });
			this.#rooms = Array.isArray(rooms) ? rooms : [];
			dispatch(this, "roomsChanged", { rooms: this.rooms });
			return this.rooms;
		} catch (error) {
			if (!isCancellation(error)) dispatch(this, "requestFailed", { error });
			throw error;
		}
	}

	start() {
		this.connection?.connect();
		this.#controller = new AbortController();
		void this.refresh().catch(() => {});
		this.#timer = setInterval(() => {
			void this.refresh().catch(() => {});
		}, this.pollMs);
	}

	join(roomId, meta = {}) {
		const room = this.#rooms.find((entry) => entry.id === roomId);
		if (!room) return false;
		const name = meta.name?.trim() || "PILOT";
		dispatch(this, "joining", { room, name });
		this.connection?.join(room.id, name);
		if (!this.connection) {
			this.#joined = { room, name };
			dispatch(this, "joined", this.joined);
		}
		return true;
	}

	requestStart() {
		if (this.#joined) dispatch(this, "start", this.joined);
	}

	chat(text) {
		this.connection?.chat(text);
	}

	leave() {
		clearInterval(this.#timer);
		this.#controller?.abort();
		this.#controller = null;
		this.connection?.leave();
		this.#joined = null;
		dispatch(this, "left");
	}

	detach() {
		for (const [target, type, handler] of this.#listeners) {
			target.removeEventListener(type, handler);
		}
		this.#listeners = [];
	}

	destroy() {
		this.leave();
		this.detach();
	}
}
