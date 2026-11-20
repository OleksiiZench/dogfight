import { describe, expect, test } from "vitest";
import {
	decodeBinaryMessage,
	decodeInput,
	decodeSnapshot,
	encodeInput,
	encodeMessage,
	encodeSnapshot,
} from "../src/protocol/codec.ts";
import { Game } from "../src/sim/game.ts";
import type { EntityData, Snapshot } from "../src/types.ts";
import { asEntityId } from "../src/types.ts";

const arena = { width: 1200, height: 700 };

function base(id: number) {
	return {
		id: asEntityId(id),
		x: 10,
		y: 20,
		vx: 0,
		vy: 0,
		angle: 0,
		age: 0,
		radius: 10,
		behaviors: [],
	};
}

describe("binary codec edge cases", () => {
	test("accepts ArrayBuffer views and rejects bad headers", () => {
		const valid = encodeInput({
			seq: 1,
			tick: 1,
			turn: 0,
			thrust: false,
			fire: false,
		});
		expect(decodeInput(new Uint8Array(valid)).seq).toBe(1);

		const badVersion = new Uint8Array(valid.slice(0));
		badVersion[0] = 9;
		expect(() => decodeInput(badVersion)).toThrow(/unsupported codec version/);

		const badType = new Uint8Array(valid.slice(0));
		badType[1] = 9;
		expect(() => decodeInput(badType)).toThrow(
			/unexpected binary message type/,
		);

		const unknownType = new Uint8Array(valid.slice(0));
		unknownType[1] = 3;
		expect(() => decodeBinaryMessage(unknownType)).toThrow(
			/unknown binary message type/,
		);

		const trailing = new Uint8Array(valid.byteLength + 1);
		trailing.set(new Uint8Array(valid));
		expect(() => decodeInput(trailing)).toThrow(/trailing bytes/);
		expect(() => decodeBinaryMessage(new Uint8Array([1]))).toThrow(/truncated/);
	});

	test("round-trips edge snapshot fields and grows the writer", () => {
		const entities: EntityData[] = [
			{
				...base(1),
				kind: "bullet",
				ownerId: "p2",
				sourceSeq: null,
				ttl: 0.5,
				damage: 20,
			},
			{
				...base(2),
				kind: "ship",
				playerId: "p1",
				color: "#fff",
				hp: 100,
				maxHp: 100,
				fireDelay: 0.25,
				cooldown: 0,
				thrusting: false,
			},
			{
				...base(3),
				kind: "asteroid",
				hp: 5,
				spin: 0,
				shape: [1],
			},
			{
				...base(4),
				kind: "pickup",
				effect: "shield",
				ttl: 1,
			},
			{
				...base(5),
				kind: "explosion",
				color: "#f00",
				life: 1,
				particles: Array.from({ length: 200 }, (_, index) => ({
					x: Number.NaN,
					y: Number.POSITIVE_INFINITY,
					vx: index,
					vy: -index,
					ttl: 0.5,
				})),
			},
		];
		const snapshot: Snapshot = {
			type: "snapshot",
			tick: 2,
			arena,
			players: [
				{
					id: "p1",
					name: "Alpha",
					color: "#fff",
					score: -3,
					shipId: null,
					respawnIn: null,
				},
			],
			entities,
			events: [{ type: "asteroidDestroyed", killerId: null }],
			lastProcessedSeq: 7,
		};

		const decoded = decodeSnapshot(encodeSnapshot(snapshot));
		expect(decoded.players[0]).toMatchObject({
			shipId: null,
			respawnIn: null,
			score: -3,
		});
		expect(
			decoded.entities.find((entity) => entity.kind === "bullet"),
		).toMatchObject({ sourceSeq: null });
		expect(
			decoded.entities.find((entity) => entity.kind === "explosion"),
		).toMatchObject({ particles: { length: 200 } });
	});

	test("falls back to JSON for malformed binary messages", () => {
		expect(encodeMessage({ type: "input", seq: 1 }, "binary")).toBeTypeOf(
			"string",
		);
		expect(encodeMessage({ type: "snapshot", arena }, "binary")).toBeTypeOf(
			"string",
		);
	});
});

describe("game event edge cases", () => {
	test("handles missing players, scoring and respawns", () => {
		const game = new Game({ seed: 7, arena, asteroidTarget: 0 });
		expect(game.removePlayer("missing")).toBeNull();
		game.addPlayer({ id: "p1", name: "Alpha", color: "#fff" });
		game.addPlayer({ id: "p2", name: "Beta", color: "#000" });
		const victim = game.players.get("p1");
		const killer = game.players.get("p2");
		if (!victim?.ship || !killer?.ship) throw new Error("missing players");

		game.world.emit({
			type: "shipDestroyed",
			ship: victim.ship,
			killerId: "p2",
		});
		game.world.emit({
			type: "shipDestroyed",
			ship: victim.ship,
			killerId: null,
		});
		game.world.emit({
			type: "shipDestroyed",
			ship: victim.ship,
			killerId: "ghost",
		});
		game.world.emit({ type: "asteroidDestroyed", killerId: "p1" });

		const events = game.processEvents();
		expect(events.some((event) => event.type === "scoreChanged")).toBe(true);
		expect(killer.score).toBeGreaterThan(0);
		expect(victim.score).toBeGreaterThan(0);
		expect(victim.respawnIn).not.toBeNull();

		victim.respawnIn = 0.01;
		game.updateRespawns(0.02);
		expect(victim.respawnIn).toBeNull();
	});
});
