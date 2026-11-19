import { fetchJson, isCancellation } from "../assets/loader.js";
import { dispatch } from "../events/bus.js";

export class Lobby extends EventTarget {
	#rooms = [];
	#controller = null;
	#timer = 0;

	constructor({
		url = "/api/rooms.json",
		pollMs = 4000,
		timeoutMs = 6000,
	} = {}) {
		super();
		this.url = url;
		this.pollMs = pollMs;
		this.timeoutMs = timeoutMs;
	}

	get rooms() {
		return [...this.#rooms];
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
		this.#controller = new AbortController();
		void this.refresh().catch(() => {});
		this.#timer = setInterval(() => {
			void this.refresh().catch(() => {});
		}, this.pollMs);
	}

	join(roomId, meta = {}) {
		const room = this.#rooms.find((entry) => entry.id === roomId);
		if (!room) return false;
		this.leave();
		dispatch(this, "joined", { room, ...meta });
		return true;
	}

	leave() {
		clearInterval(this.#timer);
		this.#controller?.abort();
		this.#controller = null;
		dispatch(this, "left");
	}
}
