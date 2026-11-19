export function createLoadingScreen({ canvas, ctx, view, onRetry, onCancel }) {
	const state = {
		phase: "loading",
		done: 0,
		total: 1,
		name: "manifest",
		failures: [],
		message: "",
	};
	let buttons = [];

	function button(id, label, x, y, width) {
		buttons.push({ id, x, y, width, height: 38, label });
		ctx.fillStyle = id === "retry" ? "#0e7490" : "#374151";
		ctx.fillRect(x, y, width, 38);
		ctx.fillStyle = "#f8fafc";
		ctx.font = "bold 14px monospace";
		ctx.textAlign = "center";
		ctx.textBaseline = "middle";
		ctx.fillText(label, x + width / 2, y + 19);
	}

	function draw() {
		const { width, height } = view;
		buttons = [];
		ctx.clearRect(0, 0, width, height);
		ctx.fillStyle = "#0b0f1a";
		ctx.fillRect(0, 0, width, height);

		const boxWidth = Math.min(640, width - 32);
		const left = (width - boxWidth) / 2;
		const top = Math.max(24, height / 2 - 190);
		const barWidth = boxWidth - 48;
		const ratio = Math.max(0, Math.min(1, state.done / state.total));

		ctx.textAlign = "left";
		ctx.textBaseline = "alphabetic";
		ctx.fillStyle = "#4ade80";
		ctx.font = "bold 34px monospace";
		ctx.fillText("DOGFIGHT", left, top + 34);
		ctx.fillStyle = "#cbd5e1";
		ctx.font = "14px monospace";
		ctx.fillText(
			state.phase === "error"
				? "Не вдалося завантажити критичний асет"
				: "Завантаження асетів…",
			left,
			top + 62,
		);

		ctx.fillStyle = "#1f2937";
		ctx.fillRect(left, top + 82, barWidth, 16);
		ctx.fillStyle = state.phase === "error" ? "#f87171" : "#22d3ee";
		ctx.fillRect(left, top + 82, barWidth * ratio, 16);
		ctx.strokeStyle = "#4b5563";
		ctx.strokeRect(left, top + 82, barWidth, 16);

		ctx.fillStyle = "#94a3b8";
		ctx.font = "13px monospace";
		ctx.fillText(
			`${state.done}/${state.total} · ${state.name}`,
			left,
			top + 122,
		);

		let lineY = top + 150;
		for (const failure of state.failures.slice(0, 3)) {
			ctx.fillStyle = "#fbbf24";
			ctx.fillText(
				`пропущено ${failure.name}: ${failure.error?.message ?? "помилка"}`,
				left,
				lineY,
			);
			lineY += 18;
		}
		if (state.phase === "cancelled") {
			ctx.fillStyle = "#fbbf24";
			ctx.fillText(state.message || "Завантаження скасовано", left, lineY);
			lineY += 18;
		}

		const buttonY = Math.max(lineY + 12, top + 216);
		const gap = 12;
		const half = (barWidth - gap) / 2;
		if (state.phase === "loading") {
			button("cancel", "Скасувати", left + barWidth - half, buttonY, half);
		} else {
			button("retry", "Повторити", left, buttonY, half);
			button("cancel", "Назад", left + half + gap, buttonY, half);
		}
	}

	function setState(patch) {
		Object.assign(state, patch);
		draw();
	}

	function onPointerDown(event) {
		const hit = buttons.find(
			(b) =>
				event.offsetX >= b.x &&
				event.offsetX <= b.x + b.width &&
				event.offsetY >= b.y &&
				event.offsetY <= b.y + b.height,
		);
		if (!hit) return;
		if (hit.id === "retry") onRetry?.();
		else onCancel?.();
	}

	canvas.addEventListener("pointerdown", onPointerDown);
	window.addEventListener("resize", draw);
	draw();

	return {
		state,
		setState,
		draw,
		dispose() {
			canvas.removeEventListener("pointerdown", onPointerDown);
			window.removeEventListener("resize", draw);
		},
	};
}
