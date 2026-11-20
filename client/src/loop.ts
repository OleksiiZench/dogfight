export interface LoopStats {
	stepsPerSecond: number;
	framesPerSecond: number;
	frameTime: number;
	workTime: number;
	frameTimes: number[];
	workTimes: number[];
}

export interface LoopOptions {
	step?: number;
	simulate(dt: number): void;
	render(alpha: number): void;
	scheduler?: "raf" | "interval";
	fixed?: boolean;
}

export interface Loop {
	readonly stats: LoopStats;
	start(): void;
	stop(): void;
}

export function createLoop({
	step = 1 / 60,
	simulate,
	render,
	scheduler = "raf",
	fixed = true,
}: LoopOptions): Loop {
	const stats: LoopStats = {
		stepsPerSecond: 0,
		framesPerSecond: 0,
		frameTime: 0,
		workTime: 0,
		frameTimes: [],
		workTimes: [],
	};

	let running = false;
	let rafId = 0;
	let intervalId: ReturnType<typeof setInterval> | null = null;
	let last: number | null = null;
	let accumulator = 0;
	let stepCount = 0;
	let frameCount = 0;
	let windowStart = 0;

	function schedule() {
		if (scheduler === "raf") rafId = requestAnimationFrame(frame);
	}

	function frame(now: number) {
		if (!running) return;

		if (last === null) {
			last = now;
			windowStart = now;
			schedule();
			return;
		}

		const rawDelta = now - last;
		last = now;
		stats.frameTime = rawDelta;
		stats.frameTimes.push(rawDelta);
		if (stats.frameTimes.length > 1800) stats.frameTimes.shift();

		// clamp: after a long hitch, do not try to catch up forever
		const delta = Math.min(rawDelta / 1000, 0.25);
		const workStart = performance.now();

		if (fixed) {
			accumulator += delta;
			while (accumulator >= step) {
				simulate(step);
				accumulator -= step;
				stepCount++;
			}
			render(accumulator / step);
		} else {
			// experiment 3 only: variable timestep
			simulate(delta);
			stepCount++;
			render(1);
		}

		stats.workTime = performance.now() - workStart;
		stats.workTimes.push(stats.workTime);
		if (stats.workTimes.length > 1800) stats.workTimes.shift();
		frameCount++;

		if (now - windowStart >= 1000) {
			const seconds = (now - windowStart) / 1000;
			stats.stepsPerSecond = stepCount / seconds;
			stats.framesPerSecond = frameCount / seconds;
			stepCount = 0;
			frameCount = 0;
			windowStart = now;
		}

		schedule();
	}

	function start() {
		if (running) return;
		running = true;
		last = null;
		accumulator = 0;
		if (scheduler === "interval") {
			// experiment 2 only
			intervalId = setInterval(() => frame(performance.now()), 16);
		} else {
			schedule();
		}
	}

	function stop() {
		running = false;
		cancelAnimationFrame(rafId);
		if (intervalId !== null) clearInterval(intervalId);
		intervalId = null;
	}

	return { start, stop, stats };
}
