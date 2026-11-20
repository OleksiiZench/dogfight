import assert from "node:assert/strict";
import { test } from "node:test";
import { Game } from "shared/sim/game.ts";
import type { Ship } from "shared/sim/ship.ts";
import type { Arena, EntityId, Intent, Snapshot } from "shared/types.ts";
import { asSeq } from "shared/types.ts";
import type { PredictorConnection } from "../src/net/predictor.ts";
import { Predictor } from "../src/net/predictor.ts";

const dt = 1 / 30;
const arena: Arena = { width: 1200, height: 700 };
const intent: Intent = { turn: 0.2, thrust: true, fire: false };

function connection(): PredictorConnection {
	return { stats: { correction: 0, pendingInputs: 0 } };
}

function newGame(): Game {
	const game = new Game({ seed: 3, arena, asteroidTarget: 0 });
	game.addPlayer({ id: "p1", name: "Alpha", color: "#4ade80" });
	game.start();
	return game;
}

function playerShip(game: Game): Ship {
	const ship = game.players.get("p1")?.ship;
	if (!ship) throw new Error("expected the local ship");
	return ship;
}

function shipId(game: Game): EntityId {
	const id = game.players.get("p1")?.shipId;
	if (id === null || id === undefined) throw new Error("expected a ship id");
	return id;
}

function snapshot(game: Game, tick: number, seq: number, offset = 0): Snapshot {
	const result = game.snapshot(tick);
	if (!result.entities.some((entity) => entity.kind === "ship"))
		throw new Error("expected a ship snapshot");
	return {
		...result,
		lastProcessedSeq: seq,
		entities: result.entities.map((entity) =>
			entity.kind === "ship" ? { ...entity, x: entity.x + offset } : entity,
		),
	};
}

test("reconciliation replays unacknowledged inputs deterministically", () => {
	const game = newGame();
	const client = new Predictor({ arena, localId: "p1", stepSeconds: dt });
	const net = connection();
	client.reconcile(snapshot(game, 0, 0), net);

	for (let i = 1; i <= 3; i++) client.applyIntent(intent);
	game.step(dt, new Map<EntityId, Intent>([[shipId(game), intent]]));
	client.reconcile(snapshot(game, 1, 1), net);

	assert.equal(net.stats.pendingInputs, 2);
	assert.ok(net.stats.correction > 0);
	game.step(dt, new Map<EntityId, Intent>([[shipId(game), intent]]));
	game.step(dt, new Map<EntityId, Intent>([[shipId(game), intent]]));
	const local = client.ship;
	if (!local) throw new Error("expected a reconciled ship");
	assert.ok(local.pos.distanceTo(playerShip(game).pos) < 1e-6);
});

test("reconciliation records authoritative correction magnitude", () => {
	const game = newGame();
	const client = new Predictor({ arena, localId: "p1", stepSeconds: dt });
	const net = connection();
	client.reconcile(snapshot(game, 0, 0), net);
	client.reconcile(snapshot(game, 1, 1, 50), net);
	assert.ok(Math.abs(net.stats.correction - 50) < 1e-6);
});

test("predicted bullet is replaced by the authoritative bullet by source seq", () => {
	const game = newGame();
	const client = new Predictor({ arena, localId: "p1", stepSeconds: dt });
	const net = connection();
	client.reconcile(snapshot(game, 0, 0), net);

	const record = client.applyIntent({ ...intent, fire: true });
	assert.equal(client.predictedBullets.size, 1);
	const predicted = [...client.predictedBullets.values()][0];
	if (!predicted) throw new Error("expected a predicted bullet");
	assert.equal(predicted.sourceSeq, record.seq);

	game.step(
		dt,
		new Map<EntityId, Intent>([
			[shipId(game), { ...intent, fire: true, seq: asSeq(record.seq) }],
		]),
	);
	client.reconcile(snapshot(game, 1, record.seq), net);

	assert.equal(client.predictedBullets.size, 0);
	assert.equal(client.confirmedBullets.has(record.seq), true);
});
