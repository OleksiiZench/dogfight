export function drawArena(ctx, arena) {
	const { width, height } = arena;
	ctx.save();
	ctx.fillStyle = "#111827";
	ctx.fillRect(0, 0, width, height);

	ctx.strokeStyle = "#1f2937";
	ctx.lineWidth = 1;
	ctx.beginPath();
	for (let x = 0; x <= width; x += 100) {
		ctx.moveTo(x, 0);
		ctx.lineTo(x, height);
	}
	for (let y = 0; y <= height; y += 100) {
		ctx.moveTo(0, y);
		ctx.lineTo(width, y);
	}
	ctx.stroke();

	ctx.strokeStyle = "#4b5563";
	ctx.lineWidth = 2;
	ctx.strokeRect(0, 0, width, height);
	ctx.restore();
}

// FPV drone, top view, drawn at the origin pointing right (+x)
export function drawShip(ctx, ship) {
	const arm = 22;

	ctx.save();
	ctx.translate(ship.x, ship.y);
	ctx.rotate(ship.angle);

	ctx.strokeStyle = "#94a3b8";
	ctx.lineWidth = 4;
	ctx.beginPath();
	ctx.moveTo(-arm, -arm);
	ctx.lineTo(arm, arm);
	ctx.moveTo(-arm, arm);
	ctx.lineTo(arm, -arm);
	ctx.stroke();

	ctx.fillStyle = "rgba(148, 163, 184, 0.35)";
	ctx.strokeStyle = "#cbd5e1";
	ctx.lineWidth = 2;
	for (const [sx, sy] of [
		[1, 1],
		[1, -1],
		[-1, 1],
		[-1, -1],
	]) {
		ctx.beginPath();
		ctx.arc(sx * arm, sy * arm, 12, 0, Math.PI * 2);
		ctx.fill();
		ctx.stroke();
	}

	ctx.fillStyle = "#4ade80";
	ctx.fillRect(-9, -9, 18, 18);

	// nose marker
	ctx.fillStyle = "#f8fafc";
	ctx.beginPath();
	ctx.moveTo(18, 0);
	ctx.lineTo(8, -6);
	ctx.lineTo(8, 6);
	ctx.closePath();
	ctx.fill();

	if (ship.thrust) {
		ctx.fillStyle = "#fb923c";
		ctx.beginPath();
		ctx.moveTo(-12, -5);
		ctx.lineTo(-32, 0);
		ctx.lineTo(-12, 5);
		ctx.closePath();
		ctx.fill();
	}

	ctx.restore();
}

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
