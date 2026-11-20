import type { Asteroid } from "shared/sim/asteroid.ts";
import { EFFECTS } from "shared/sim/behaviors.ts";
import type { Bullet } from "shared/sim/bullet.ts";
import type { AnyEntity } from "shared/sim/entity.ts";
import type { Explosion } from "shared/sim/explosion.ts";
import { RESPAWN_DELAY } from "shared/sim/game.ts";
import type { Pickup } from "shared/sim/pickup.ts";
import type { Ship } from "shared/sim/ship.ts";
import type {
	Arena,
	EntityKind,
	PlayerId,
	PlayerSnapshot,
} from "shared/types.ts";
import { assertNever } from "shared/types.ts";
import type { LoopStats } from "../loop.ts";
import type { ConnectionStats } from "../net/connection.ts";
import type { ViewSize } from "./canvas.ts";
import type { Sprites } from "./sprites.ts";
import { drawSprite } from "./sprites.ts";

export function drawArena(ctx: CanvasRenderingContext2D, arena: Arena): void {
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
function drawDrone(ctx: CanvasRenderingContext2D, ship: Ship): void {
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
	const corners: readonly (readonly [number, number])[] = [
		[1, 1],
		[1, -1],
		[-1, 1],
		[-1, -1],
	];
	for (const [sx, sy] of corners) {
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

function drawShip(
	ctx: CanvasRenderingContext2D,
	ship: Ship,
	alpha: number,
	sprites: Sprites | null,
): void {
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

function drawBullet(
	ctx: CanvasRenderingContext2D,
	bullet: Bullet,
	alpha: number,
	sprites: Sprites | null,
): void {
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

function drawAsteroid(
	ctx: CanvasRenderingContext2D,
	asteroid: Asteroid,
	alpha: number,
	sprites: Sprites | null,
): void {
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
		const r = asteroid.radius * (asteroid.shape[i] ?? 1);
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

function drawPickup(
	ctx: CanvasRenderingContext2D,
	pickup: Pickup,
	alpha: number,
	sprites: Sprites | null,
): void {
	const pos = pickup.renderPos(alpha);
	const effect = EFFECTS.get(pickup.effect);
	if (!effect) return;
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

function drawExplosion(
	ctx: CanvasRenderingContext2D,
	explosion: Explosion,
): void {
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
export const DRAW_ORDER: readonly EntityKind[] = [
	"pickup",
	"asteroid",
	"bullet",
	"ship",
	"explosion",
];

export function drawEntity(
	ctx: CanvasRenderingContext2D,
	entity: AnyEntity,
	alpha: number,
	sprites: Sprites | null,
): void {
	switch (entity.kind) {
		case "ship":
			drawShip(ctx, entity, alpha, sprites);
			break;
		case "bullet":
			drawBullet(ctx, entity, alpha, sprites);
			break;
		case "asteroid":
			drawAsteroid(ctx, entity, alpha, sprites);
			break;
		case "pickup":
			drawPickup(ctx, entity, alpha, sprites);
			break;
		case "explosion":
			drawExplosion(ctx, entity);
			break;
		default:
			assertNever(entity);
	}
}

export function drawHud(ctx: CanvasRenderingContext2D, stats: LoopStats): void {
	const lines = [
		`steps/s:    ${stats.stepsPerSecond.toFixed(1)}`,
		`frames/s:   ${stats.framesPerSecond.toFixed(1)}`,
		`frame time: ${stats.frameTime.toFixed(2)} ms`,
		`work time:  ${stats.workTime.toFixed(2)} ms`,
		`build:      ${__APP_VERSION__}`,
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

export interface NetGraphStats extends ConnectionStats {
	tick?: number;
}

export function drawNetgraph(
	ctx: CanvasRenderingContext2D,
	view: ViewSize,
	stats: NetGraphStats,
): void {
	const lines = [
		`rtt:       ${stats.rttMs.toFixed(0)} ms`,
		`snap age:  ${stats.snapshotAgeMs.toFixed(0)} ms`,
		`down/up:   ${(stats.bytesInPerSec / 1024).toFixed(1)}/${(stats.bytesOutPerSec / 1024).toFixed(1)} KB/s`,
		`pending:   ${stats.pendingInputs}`,
		`correction:${stats.correction.toFixed(1)} px`,
		`interp:    ${stats.interpolationDelayMs.toFixed(0)} ms`,
		`tick:      ${stats.tick ?? 0}`,
	];

	ctx.save();
	ctx.fillStyle = "#38bdf8";
	ctx.font = "13px monospace";
	ctx.textBaseline = "bottom";
	lines.forEach((text, i) => {
		ctx.fillText(text, 12, view.height - 32 - (lines.length - 1 - i) * 17);
	});
	ctx.restore();
}

export interface ScoreboardGame {
	arena: Arena;
	players: ReadonlyMap<PlayerId, PlayerSnapshot>;
}

export function drawScoreboard(
	ctx: CanvasRenderingContext2D,
	game: ScoreboardGame,
	view: ViewSize,
	localId: PlayerId,
	scores: ReadonlyMap<PlayerId, number> | null | undefined,
): void {
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
