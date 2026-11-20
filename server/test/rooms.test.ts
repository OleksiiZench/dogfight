import assert from "node:assert/strict";
import { test } from "node:test";
import type { RoomEvent } from "../src/rooms.ts";
import { RoomManager } from "../src/rooms.ts";

const definition = {
	id: "training",
	name: "Training",
	seed: 1,
	arena: { width: 1200, height: 700 },
	asteroidTarget: 3,
	capacity: 1,
};

test("room records join, chat and leave", () => {
	const manager = new RoomManager({ definitions: [definition], maxRooms: 2 });
	const room = manager.get("training");
	assert.ok(room);
	const events: string[] = [];
	room.on("event", (event: RoomEvent) => events.push(event.type));

	const player = room.join({ id: "p1", name: "Alpha" });
	assert.equal(player.name, "Alpha");
	assert.equal(room.chat("p1", "hello").text, "hello");
	room.leave("p1");

	assert.deepEqual(events, ["join", "chat", "leave"]);
	assert.equal(room.isEmpty, true);
});

test("room manager deletes empty rooms and enforces limits", () => {
	const manager = new RoomManager({ definitions: [definition], maxRooms: 2 });
	const room = manager.get("training");
	assert.ok(room);
	room.join({ id: "p1", name: "Alpha" });
	room.leave("p1");
	assert.equal(manager.get("training"), null);

	const created = manager.create({ ...definition, id: "dogfight" });
	assert.equal(created.id, "dogfight");
	assert.throws(
		() => manager.create({ ...definition, id: "dogfight" }),
		/already exists/,
	);
});
