export function setupCanvas(canvas) {
	const ctx = canvas.getContext("2d");
	const view = { width: 0, height: 0 };

	function resize() {
		const dpr = window.devicePixelRatio || 1;
		view.width = window.innerWidth;
		view.height = window.innerHeight;
		canvas.width = Math.round(view.width * dpr);
		canvas.height = Math.round(view.height * dpr);
		ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
	}

	window.addEventListener("resize", resize);
	resize();

	return { ctx, view };
}
