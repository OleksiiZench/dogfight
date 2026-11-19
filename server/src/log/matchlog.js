import { createWriteStream } from "node:fs";
import { resolve } from "node:path";
import { PassThrough, Transform } from "node:stream";
import { pipeline } from "node:stream/promises";

export class JsonLinesTransform extends Transform {
	constructor() {
		super({ objectMode: true });
	}

	_transform(event, _encoding, callback) {
		try {
			this.push(`${JSON.stringify(event)}\n`);
			callback();
		} catch (error) {
			callback(error);
		}
	}
}

export function attachMatchLog(room, config) {
	const stamp = new Date().toISOString().replace(/[:.]/g, "-");
	const id = `${room.id}-${stamp}`;
	const filePath = resolve(config.logDir, `${id}.ndjson`);
	const source = new PassThrough({ objectMode: true });
	source.on("error", (error) =>
		console.error(`[matchlog ${id}]`, error.message),
	);

	const onEvent = (event) => source.write(event);
	room.on("event", onEvent);

	const done = pipeline(
		source,
		new JsonLinesTransform(),
		createWriteStream(filePath),
	);
	done.catch((error) => console.error(`[matchlog ${id}]`, error.message));

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
