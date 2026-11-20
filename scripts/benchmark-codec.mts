import { performance } from "node:perf_hooks";
import {
	decodeSnapshot,
	encodeInput,
	encodeSnapshot,
} from "shared/protocol/codec.ts";
import type { Player } from "shared/sim/game.ts";
import { Game } from "shared/sim/game.ts";
import type {
	EntityId,
	GameEvent,
	InputFields,
	Intent,
	Snapshot,
} from "shared/types.ts";
import { asEntityId, asSeq, asTick } from "shared/types.ts";

const COLORS: readonly string[] = ["#ff5555", "#55ff55", "#5555ff", "#ffff55"];

const game = new Game({
	seed: 42,
	arena: { width: 1280, height: 720 },
	asteroidTarget: 6,
});
const players: Player[] = [];
for (let i = 0; i < 4; i++) {
	players.push(
		game.addPlayer({
			id: `player-${i}`,
			name: `Pilot ${i}`,
			color: COLORS[i] ?? "#ffff55",
		}),
	);
}
game.start();
for (let tick = 0; tick < 180; tick++) {
	const intents = new Map<EntityId, Intent>();
	players.forEach((_player, index) => {
		intents.set(asEntityId(1000 + index), {
			seq: asSeq(tick + 1),
			turn: Math.sin(tick / 20 + index) * 0.5,
			thrust: true,
			fire: tick % 6 === 0,
		});
	});
	game.step(1 / 30, intents);
}
const events: GameEvent[] = [
	{ type: "scoreChanged", scores: { "player-0": 10 } },
];
const snapshot: Snapshot = {
	...game.snapshot(180),
	events,
	lastProcessedSeq: 180,
};
const input: InputFields = {
	seq: asSeq(180),
	tick: asTick(180),
	turn: 0.25,
	thrust: true,
	fire: false,
};

const jsonText = JSON.stringify(snapshot);
const binaryData = encodeSnapshot(snapshot);
const jsonInput = JSON.stringify({ v: 1, type: "input", ...input });
const binaryInput = encodeInput(input);

function microseconds(action: () => void, iterations = 2000): number {
	const started = performance.now();
	for (let i = 0; i < iterations; i++) action();
	return ((performance.now() - started) * 1000) / iterations;
}

const jsonEncode = microseconds(() => {
	JSON.stringify(snapshot);
});
const jsonDecode = microseconds(() => {
	void JSON.parse(jsonText);
});
const binaryEncode = microseconds(() => {
	encodeSnapshot(snapshot);
});
const binaryDecode = microseconds(() => {
	decodeSnapshot(binaryData);
});
const rate = (bytes: number): string => ((bytes * 30) / 1024).toFixed(2);
const total = (value: number): string => value.toFixed(2);
const saving = (json: number, binary: number): string =>
	((1 - binary / json) * 100).toFixed(1);

console.log(
	`| Метрика (30 Гц, 4 гравці) | JSON | Binary | Менше, % |
| --- | ---: | ---: | ---: |
| Snapshot, bytes | ${Buffer.byteLength(jsonText)} | ${binaryData.byteLength} | ${saving(Buffer.byteLength(jsonText), binaryData.byteLength)} |
| Downstream на клієнта | ${rate(Buffer.byteLength(jsonText))} KiB/s | ${rate(binaryData.byteLength)} KiB/s | ${saving(Buffer.byteLength(jsonText), binaryData.byteLength)} |
| Upstream на клієнта | ${rate(Buffer.byteLength(jsonInput))} KiB/s | ${rate(binaryInput.byteLength)} KiB/s | ${saving(Buffer.byteLength(jsonInput), binaryInput.byteLength)} |
| Upstream 4 гравців | ${rate(Buffer.byteLength(jsonInput) * 4)} KiB/s | ${rate(binaryInput.byteLength * 4)} KiB/s | ${saving(Buffer.byteLength(jsonInput), binaryInput.byteLength)} |
| Input, bytes | ${Buffer.byteLength(jsonInput)} | ${binaryInput.byteLength} | ${saving(Buffer.byteLength(jsonInput), binaryInput.byteLength)} |
| Encode + decode, µs | ${total(jsonEncode + jsonDecode)} | ${total(binaryEncode + binaryDecode)} | ${saving(jsonEncode + jsonDecode, binaryEncode + binaryDecode)} |`,
);
console.log(`\nEntities in measured snapshot: ${snapshot.entities.length}`);
