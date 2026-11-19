export function createInput(target) {
	const down = new Set();
	const pressed = new Set();

	target.addEventListener("keydown", (e) => {
		if (e.code.startsWith("Arrow") || e.code === "Space") e.preventDefault();
		if (e.repeat) return;
		if (!down.has(e.code)) pressed.add(e.code);
		down.add(e.code);
	});

	target.addEventListener("keyup", (e) => {
		down.delete(e.code);
	});

	// do not leave keys "stuck" when the window loses focus
	target.addEventListener("blur", () => {
		down.clear();
	});

	return {
		isDown: (code) => down.has(code),
		// true only for the first simulation step after the key went down
		justPressed: (code) => pressed.has(code),
		// call once at the end of every simulation step
		endStep: () => pressed.clear(),
	};
}
