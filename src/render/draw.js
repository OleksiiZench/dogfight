import { EFFECTS } from "../sim/behaviors.js";
import { RESPAWN_DELAY } from "../sim/game.js";
import { drawSprite } from "./sprites.js";

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
function drawDrone(ctx, ship) {
	const arm = 22;

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

	ctx.fillStyle = ship.color;
	ctx.fillRect(-9, -9, 18, 18);

	// nose marker
	ctx.fillStyle = "#f8fafc";
	ctx.beginPath();
	ctx.moveTo(18, 0);
	ctx.lineTo(8, -6);
	ctx.lineTo(8, 6);
	ctx.closePath();
	ctx.fill();
}

function drawShip(ctx, ship, alpha, sprites) {
	const pos = ship.renderPos(alpha);
	const angle = ship.renderAngle(alpha);
	const hitFlash =
		ship.hasBehavior("invuln") && Math.floor(ship.age * 12) % 2 === 0;

	ctx.save();
	ctx.translate(pos.x, pos.y);

	ctx.save();
	ctx.rotate(angle);
	ctx.globalAlpha = hitFlash ? 0.35 : 1;
	if (!drawSprite(ctx, sprites?.ship, 96)) drawDrone(ctx, ship);
	ctx.fillStyle = ship.color;
	ctx.fillRect(-9, -9, 18, 18);
	if (ship.thrusting) {
		ctx.fillStyle = "#fb923c";
		ctx.beginPath();
		ctx.moveTo(-12, -5);
		ctx.lineTo(-32, 0);
		ctx.lineTo(-12, 5);
		ctx.closePath();
		ctx.fill();
	}
	ctx.restore();

	if (ship.hasBehavior("shield")) {
		ctx.strokeStyle = "#22d3ee";
		ctx.lineWidth = 2;
		ctx.beginPath();
		ctx.arc(0, 0, ship.radius + 12, 0, Math.PI * 2);
		ctx.stroke();
	}

	// hp bar above the ship
	const barWidth = 44;
	const top = -ship.radius - 28;
	ctx.fillStyle = "rgba(0, 0, 0, 0.5)";
	ctx.fillRect(-barWidth / 2, top, barWidth, 5);
	ctx.fillStyle = ship.color;
	ctx.fillRect(-barWidth / 2, top, (barWidth * ship.hp) / ship.maxHp, 5);

	ctx.restore();
}

function drawBullet(ctx, bullet, alpha, sprites) {
	const pos = bullet.renderPos(alpha);
	const angle = Math.atan2(bullet.vel.y, bullet.vel.x);
	ctx.save();
	ctx.translate(pos.x, pos.y);
	if (drawSprite(ctx, sprites?.bullet, 56, angle)) {
		ctx.restore();
		return;
	}
	const tail = bullet.vel.normalize().scale(14);
	ctx.strokeStyle = bullet.hasBehavior("homing") ? "#f472b6" : "#fde68a";
	ctx.lineWidth = 3;
	ctx.lineCap = "round";
	ctx.beginPath();
	ctx.moveTo(-tail.x, -tail.y);
	ctx.lineTo(0, 0);
	ctx.stroke();
	ctx.restore();
}

function drawAsteroid(ctx, asteroid, alpha, sprites) {
	const pos = asteroid.renderPos(alpha);
	const angle = asteroid.renderAngle(alpha);
	const count = asteroid.shape.length;

	ctx.save();
	ctx.translate(pos.x, pos.y);
	if (drawSprite(ctx, sprites?.asteroid, asteroid.radius * 2.4, angle)) {
		ctx.restore();
		return;
	}
	ctx.rotate(angle);
	ctx.beginPath();
	for (let i = 0; i < count; i++) {
		const a = (i / count) * Math.PI * 2;
		const r = asteroid.radius * asteroid.shape[i];
		const x = Math.cos(a) * r;
		const y = Math.sin(a) * r;
		if (i === 0) ctx.moveTo(x, y);
		else ctx.lineTo(x, y);
	}
	ctx.closePath();
	ctx.fillStyle = "#374151";
	ctx.fill();
	ctx.strokeStyle = asteroid.hasBehavior("homing") ? "#f87171" : "#9ca3af";
	ctx.lineWidth = 2;
	ctx.stroke();
	ctx.restore();
}

function drawPickup(ctx, pickup, alpha, sprites) {
	const pos = pickup.renderPos(alpha);
	const effect = EFFECTS.get(pickup.effect);
	const pulse = Math.sin(pickup.age * 4) * 2;

	ctx.save();
	ctx.translate(pos.x, pos.y);
	if (drawSprite(ctx, sprites?.pickup, pickup.radius * 3)) {
		ctx.restore();
		return;
	}
	ctx.strokeStyle = effect.color;
	ctx.fillStyle = effect.color;
	ctx.lineWidth = 3;
	ctx.beginPath();
	ctx.arc(0, 0, pickup.radius + pulse, 0, Math.PI * 2);
	ctx.stroke();
	ctx.font = "bold 16px monospace";
	ctx.textAlign = "center";
	ctx.textBaseline = "middle";
	ctx.fillText(effect.label, 0, 1);
	ctx.restore();
}

function drawExplosion(ctx, explosion) {
	ctx.save();
	ctx.fillStyle = explosion.color;
	for (const p of explosion.particles) {
		if (p.ttl <= 0) continue;
		ctx.globalAlpha = Math.min(1, p.ttl / explosion.life);
		ctx.fillRect(p.pos.x - 2, p.pos.y - 2, 4, 4);
	}
	ctx.restore();
}

// data-driven: one drawer per entity kind
const DRAWERS = new Map([
	["ship", drawShip],
	["bullet", drawBullet],
	["asteroid", drawAsteroid],
	["pickup", drawPickup],
	["explosion", drawExplosion],
]);

// back to front
export const DRAW_ORDER = ["pickup", "asteroid", "bullet", "ship", "explosion"];

export function drawEntity(ctx, entity, alpha, sprites) {
	DRAWERS.get(entity.kind)?.(ctx, entity, alpha, sprites);
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

export function drawScoreboard(ctx, game, view, localId, scores) {
	const players = [...game.players.values()];
	const gap = 180;
	const startX = view.width / 2 - ((players.length - 1) * gap) / 2;

	ctx.save();
	ctx.font = "bold 18px monospace";
	ctx.textAlign = "center";
	ctx.textBaseline = "top";
	players.forEach((player, i) => {
		ctx.fillStyle = player.color;
		ctx.fillText(
			`${player.name}: ${scores?.get(player.id) ?? 0}`,
			startX + i * gap,
			12,
		);
	});

	const local = game.players.get(localId);
	if (local && local.respawnIn !== null) {
		const left = Math.max(0, Math.min(RESPAWN_DELAY, local.respawnIn));
		ctx.fillStyle = "#f8fafc";
		ctx.font = "bold 28px monospace";
		ctx.textBaseline = "middle";
		ctx.fillText(
			`Respawn in ${left.toFixed(1)} s`,
			view.width / 2,
			view.height / 2,
		);
	}

	ctx.fillStyle = "#6b7280";
	ctx.font = "13px monospace";
	ctx.textBaseline = "bottom";
	ctx.fillText(
		"arrows / WASD: fly · Space or click: fire",
		view.width / 2,
		view.height - 10,
	);
	ctx.restore();
}
