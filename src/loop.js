export function createLoop({ step = 1 / 60, simulate, render }) {
	const stats = {
		stepsPerSecond: 0,
		framesPerSecond: 0,
		frameTime: 0,
		workTime: 0,
	};

	let running = false;
	let rafId = 0;
	let last = null;
	let accumulator = 0;
	let stepCount = 0;
	let frameCount = 0;
	let windowStart = 0;

	function frame(now) {
		if (!running) return;

		if (last === null) {
			last = now;
			windowStart = now;
			rafId = requestAnimationFrame(frame);
			return;
		}

		const rawDelta = now - last;
		last = now;
		stats.frameTime = rawDelta;

		// clamp: after a long hitch, do not try to catch up forever
		accumulator += Math.min(rawDelta / 1000, 0.25);

		const workStart = performance.now();

		while (accumulator >= step) {
			simulate(step);
			accumulator -= step;
			stepCount++;
		}

		render(accumulator / step);

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

		rafId = requestAnimationFrame(frame);
	}

	function start() {
		if (running) return;
		running = true;
		last = null;
		accumulator = 0;
		rafId = requestAnimationFrame(frame);
	}

	function stop() {
		running = false;
		cancelAnimationFrame(rafId);
	}

	return { start, stop, stats };
}
