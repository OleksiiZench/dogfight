import fc from "fast-check";
import { describe, expect, test } from "vitest";
import { decodeInput, encodeInput } from "../src/protocol/codec.ts";
import { parseClientMessage } from "../src/protocol/schema.ts";
import { Game } from "../src/sim/game.ts";
import type { EntityId, Intent } from "../src/types.ts";

const arena = { width: 1200, height: 700 };

describe("property-based protocol tests", () => {
	test("input round-trips within quantization tolerance", () => {
		fc.assert(
			fc.property(
				fc.integer({ min: 0, max: 10000 }),
				fc.integer({ min: 0, max: 10000 }),
				fc.integer({ min: -1000, max: 1000 }),
				fc.boolean(),
				fc.boolean(),
				(seq, tick, turn, thrust, fire) => {
					const decoded = decodeInput(
						encodeInput({
							seq,
							tick,
							turn: turn / 1000,
							thrust,
							fire,
						}),
					);
					expect(decoded.seq).toBe(seq);
					expect(decoded.tick).toBe(tick);
					expect(Math.abs(decoded.turn - turn / 1000)).toBeLessThanOrEqual(
						0.001,
					);
					expect(decoded.thrust).toBe(thrust);
					expect(decoded.fire).toBe(fire);
				},
			),
		);
	});

	test("encoded input length always matches the spec", () => {
		fc.assert(
			fc.property(
				fc.integer({ min: 0, max: 65535 }),
				fc.integer({ min: 0, max: 65535 }),
				fc.integer({ min: -1000, max: 1000 }),
				fc.boolean(),
				fc.boolean(),
				(seq, tick, turn, thrust, fire) => {
					expect(
						encodeInput({ seq, tick, turn: turn / 1000, thrust, fire })
							.byteLength,
					).toBe(14);
				},
			),
		);
	});

	test("garbage buffers never crash unexpectedly", () => {
		fc.assert(
			fc.property(fc.uint8Array({ minLength: 0, maxLength: 64 }), (bytes) => {
				let message: unknown;
				try {
					message = decodeInput(bytes.buffer);
				} catch (error) {
					expect(error).toBeInstanceOf(Error);
					return;
				}
				expect(message).toMatchObject({ type: "input" });
			}),
		);
	});

	test("ships stay inside the arena over random inputs", () => {
		fc.assert(
			fc.property(
				fc.integer({ min: 1, max: 10000 }),
				fc.array(
					fc.record({
						turn: fc.integer({ min: -1000, max: 1000 }),
						thrust: fc.boolean(),
					}),
					{ minLength: 10, maxLength: 30 },
				),
				(seed, inputs) => {
					const game = new Game({
						seed,
						arena,
						asteroidTarget: 0,
					});
					game.addPlayer({ id: "p1", name: "Alpha", color: "#fff" });
					game.start();
					const id = game.players.get("p1")?.shipId;
					if (id === null || id === undefined)
						throw new Error("missing ship id");
					const intents = new Map<EntityId, Intent>();
					for (const input of inputs) {
						intents.set(id, {
							turn: input.turn / 1000,
							thrust: input.thrust,
							fire: false,
						});
						game.step(1 / 30, intents);
					}
					const ship = game.players.get("p1")?.ship;
					if (!ship) throw new Error("missing ship");
					expect(ship.pos.x).toBeGreaterThanOrEqual(0);
					expect(ship.pos.x).toBeLessThan(arena.width);
					expect(ship.pos.y).toBeGreaterThanOrEqual(0);
					expect(ship.pos.y).toBeLessThan(arena.height);
				},
			),
		);
	});

	test("parseClientMessage accepts generated valid messages", () => {
		fc.assert(
			fc.property(
				fc.oneof(
					fc.record({
						v: fc.constant(1),
						type: fc.constant("join"),
						room: fc.constant("training"),
						codec: fc.constant("json"),
						name: fc
							.string({ minLength: 0, maxLength: 9 })
							.map((value) => `A${value}`),
					}),
					fc.record({
						v: fc.constant(1),
						type: fc.constant("chat"),
						text: fc
							.string({ minLength: 0, maxLength: 19 })
							.map((value) => `T${value}`),
					}),
					fc.record({
						v: fc.constant(1),
						type: fc.constant("leave"),
					}),
				),
				(message) => {
					expect(parseClientMessage(JSON.stringify(message)).ok).toBe(true);
				},
			),
		);
	});

	test("parseClientMessage rejects mutated messages", () => {
		fc.assert(
			fc.property(fc.string({ minLength: 1, maxLength: 20 }), (text) => {
				expect(
					parseClientMessage(JSON.stringify({ v: 1, type: "unknown", text }))
						.ok,
				).toBe(false);
				expect(
					parseClientMessage(JSON.stringify({ v: 2, type: "chat", text })).ok,
				).toBe(false);
			}),
		);
	});

	test("simulation is deterministic for arbitrary seeds", () => {
		fc.assert(
			fc.property(fc.integer({ min: 0, max: 100000 }), (seed) => {
				const run = () => {
					const game = new Game({ seed, arena, asteroidTarget: 2 });
					game.addPlayer({ id: "p1", name: "Alpha", color: "#fff" });
					game.start();
					for (let i = 0; i < 50; i++) game.step(1 / 60);
					return JSON.stringify(game.snapshot(1));
				};
				expect(run()).toBe(run());
			}),
		);
	});
});
