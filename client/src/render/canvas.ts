export interface ViewSize {
	width: number;
	height: number;
}

export interface CanvasSetup {
	ctx: CanvasRenderingContext2D;
	view: ViewSize;
}

export function setupCanvas(canvas: HTMLCanvasElement): CanvasSetup {
	const context = canvas.getContext("2d");
	if (!context) throw new Error("2D canvas context is unavailable");
	const ctx: CanvasRenderingContext2D = context;
	const view: ViewSize = { width: 0, height: 0 };

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
