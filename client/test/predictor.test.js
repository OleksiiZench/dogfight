import assert from "node:assert/strict";
import { test } from "node:test";
import { Game } from "shared/sim/game.js";
import { Predictor } from "../src/net/predictor.js";

const dt = 1 / 30;
const arena = { width: 1200, height: 700 };
const intent = { turn: 0.2, thrust: true, fire: false };

function connection() {
	return { stats: { correction: 0, pendingInputs: 0 } };
}

function newGame() {
	const game = new Game({ seed: 3, arena, asteroidTarget: 0 });
	game.addPlayer({ id: "p1", name: "Alpha", color: "#4ade80" });
	game.start();
	return game;
}

function snapshot(game, tick, seq, offset = 0) {
	const result = game.snapshot(tick);
	result.lastProcessedSeq = seq;
	const ship = result.entities.find((entity) => entity.kind === "ship");
	ship.x += offset;
	return result;
}

test("reconciliation replays unacknowledged inputs deterministically", () => {
	const game = newGame();
	const client = new Predictor({ arena, localId: "p1", stepSeconds: dt });
	const net = connection();
	client.reconcile(snapshot(game, 0, 0), net);

	for (let i = 1; i <= 3; i++) client.applyIntent(intent);
	game.step(dt, new Map([[game.players.get("p1").shipId, intent]]));
	client.reconcile(snapshot(game, 1, 1), net);

	assert.equal(net.stats.pendingInputs, 2);
	assert.ok(net.stats.correction > 0);
	game.step(dt, new Map([[game.players.get("p1").shipId, intent]]));
	game.step(dt, new Map([[game.players.get("p1").shipId, intent]]));
	assert.ok(client.ship.pos.distanceTo(game.players.get("p1").ship.pos) < 1e-6);
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
	assert.equal([...client.predictedBullets.values()][0].sourceSeq, record.seq);

	game.step(
		dt,
		new Map([
			[
				game.players.get("p1").shipId,
				{ ...intent, fire: true, seq: record.seq },
			],
		]),
	);
	client.reconcile(snapshot(game, 1, record.seq), net);

	assert.equal(client.predictedBullets.size, 0);
	assert.equal(client.confirmedBullets.has(record.seq), true);
});
