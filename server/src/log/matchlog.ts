import { createWriteStream } from "node:fs";
import { resolve } from "node:path";
import type { TransformCallback } from "node:stream";
import { PassThrough, Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import type { Room, RoomEvent } from "../rooms.ts";

export class JsonLinesTransform extends Transform {
	constructor() {
		super({ objectMode: true });
	}

	override _transform(
		event: unknown,
		_encoding: BufferEncoding,
		callback: TransformCallback,
	): void {
		try {
			this.push(`${JSON.stringify(event)}\n`);
			callback();
		} catch (error) {
			callback(error instanceof Error ? error : new Error(String(error)));
		}
	}
}

export interface MatchLog {
	id: string;
	filePath: string;
	roomId: string;
	close(): Promise<void>;
}

export function attachMatchLog(
	room: Room,
	config: { logDir: string },
): MatchLog {
	const stamp = new Date().toISOString().replace(/[:.]/g, "-");
	const id = `${room.id}-${stamp}`;
	const filePath = resolve(config.logDir, `${id}.ndjson`);
	const source = new PassThrough({ objectMode: true });
	source.on("error", (error: Error) =>
		console.error(`[matchlog ${id}]`, error.message),
	);

	const onEvent = (event: RoomEvent): void => {
		source.write(event);
	};
	room.on("event", onEvent);

	const done = pipeline(
		source,
		new JsonLinesTransform(),
		createWriteStream(filePath),
	);
	done.catch((error: unknown) =>
		console.error(
			`[matchlog ${id}]`,
			error instanceof Error ? error.message : String(error),
		),
	);

	let closed = false;
	return {
		id,
		filePath,
		roomId: room.id,
		async close() {
			if (closed) return;
			closed = true;
			room.off("event", onEvent);
			source.end();
			await done.catch(() => {});
		},
	};
}
