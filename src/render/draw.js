export function drawHud(ctx, stats) {
	const lines = [
		`steps/s:    ${stats.stepsPerSecond.toFixed(1)}`,
		`frames/s:   ${stats.framesPerSecond.toFixed(1)}`,
		`frame time: ${stats.frameTime.toFixed(2)} ms`,
		`work time:  ${stats.workTime.toFixed(2)} ms`,
	];

	ctx.save();
	ctx.fillStyle = "#4ade80";
	ctx.font = "14px monospace";
	ctx.textBaseline = "top";
	lines.forEach((text, i) => {
		ctx.fillText(text, 12, 12 + i * 18);
	});
	ctx.restore();
}
