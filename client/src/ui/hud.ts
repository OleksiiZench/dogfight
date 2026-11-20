export function createHud(bus) {
	const scores = new Map();

	bus.addEventListener("scoreChanged", (event) => {
		for (const [id, score] of event.detail.scores) scores.set(id, score);
	});

	return { scores };
}
