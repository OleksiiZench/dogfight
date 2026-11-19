export function createLoop({
	step = 1 / 60,
	simulate,
	render,
	scheduler = "raf",
	fixed = true,
}) {
	const stats = {
		stepsPerSecond: 0,
		framesPerSecond: 0,
		frameTime: 0,
		workTime: 0,
	};

	let running = false;
	let rafId = 0;
	let intervalId = 0;
	let last = null;
	let accumulator = 0;
	let stepCount = 0;
	let frameCount = 0;
	let windowStart = 0;

	function schedule() {
		if (scheduler === "raf") rafId = requestAnimationFrame(frame);
	}

	function frame(now) {
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
		clearInterval(intervalId);
	}

	return { start, stop, stats };
}
