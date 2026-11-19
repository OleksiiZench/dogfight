// Query flags used for the "break it on purpose" experiments (see README).
export function readParams() {
	const query = new URLSearchParams(window.location.search);
	return {
		scheduler: query.get("scheduler") === "interval" ? "interval" : "raf",
		fixed: query.get("fixed") !== "0",
		busy: query.get("busy") === "1",
		auto: query.get("auto") === "1",
		measure: query.get("measure") === "1",
	};
}

export function busyWait(ms) {
	const end = performance.now() + ms;
	while (performance.now() < end) {
		// spin: blocks the main thread on purpose
	}
}

// input that holds "thrust" forever, for reproducible runs
export function createAutoInput() {
	return {
		isDown: (code) => code === "ArrowUp",
		justPressed: () => false,
		endStep() {
			// nothing to reset
		},
	};
}

// collects frame times for N seconds, then prints a summary to the console
export function createRecorder(seconds) {
	const samples = [];
	let startedAt = null;
	let done = false;

	return (frameTime) => {
		if (done) return;
		const now = performance.now();
		if (startedAt === null) startedAt = now;
		samples.push(frameTime);
		if (now - startedAt < seconds * 1000) return;

		done = true;
		const mean = samples.reduce((a, b) => a + b, 0) / samples.length;
		const variance =
			samples.reduce((a, b) => a + (b - mean) ** 2, 0) / samples.length;
		console.log(`[measure ${seconds}s]`, {
			frames: samples.length,
			fps: +(samples.length / seconds).toFixed(1),
			meanMs: +mean.toFixed(2),
			stddevMs: +Math.sqrt(variance).toFixed(2),
			minMs: +Math.min(...samples).toFixed(2),
			maxMs: +Math.max(...samples).toFixed(2),
		});
	};
}
