export interface AudioController {
	readonly context: AudioContext;
	set(name: string, buffer: AudioBuffer): void;
	unlock(): Promise<void>;
	play(name: string, options?: { volume?: number }): void;
}

export function createAudio(): AudioController {
	let ctx: AudioContext | null = null;
	const buffers = new Map<string, AudioBuffer>();

	function context(): AudioContext {
		if (!ctx) ctx = new AudioContext();
		return ctx;
	}

	return {
		get context() {
			return context();
		},
		set(name, buffer) {
			if (buffer) buffers.set(name, buffer);
		},
		async unlock() {
			const audio = context();
			if (audio.state === "suspended") await audio.resume();
		},
		play(name, { volume = 0.4 } = {}) {
			const buffer = buffers.get(name);
			if (!buffer || !ctx || ctx.state !== "running") return;

			const source = ctx.createBufferSource();
			const gain = ctx.createGain();
			source.buffer = buffer;
			gain.gain.value = volume;
			source.connect(gain).connect(ctx.destination);
			source.start();
		},
	};
}

export function attachAudio(bus: EventTarget, audio: AudioController): void {
	bus.addEventListener("fired", () => audio.play("shoot", { volume: 0.18 }));
	bus.addEventListener("hit", () => audio.play("hit", { volume: 0.25 }));
	bus.addEventListener("exploded", () =>
		audio.play("explosion", { volume: 0.4 }),
	);
	bus.addEventListener("pickup", () => audio.play("pickup", { volume: 0.3 }));
}
