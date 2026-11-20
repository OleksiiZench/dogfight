import { createReadStream } from "node:fs";
import { readdir, stat } from "node:fs/promises";
import { resolve, sep } from "node:path";
import { createInterface } from "node:readline";
import { pipeline } from "node:stream/promises";

const REPLAY_ID = /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/;

function invalid(message, status = 400) {
	const error = new Error(message);
	error.status = status;
	return error;
}

export function replayPath(logDir, id) {
	const value = String(id ?? "");
	if (!REPLAY_ID.test(value)) throw invalid("invalid replay id");
	const filePath = resolve(logDir, `${value}.ndjson`);
	if (!filePath.startsWith(`${logDir}${sep}`))
		throw invalid("invalid replay path");
	return filePath;
}

export async function listReplays(logDir) {
	const entries = await readdir(logDir);
	const files = entries.filter((entry) => entry.endsWith(".ndjson"));
	const details = await Promise.all(
		files.map(async (file) => {
			const info = await stat(resolve(logDir, file));
			return {
				id: file.slice(0, -".ndjson".length),
				bytes: info.size,
				modified: info.mtime.toISOString(),
			};
		}),
	);
	return details.sort((a, b) => b.modified.localeCompare(a.modified));
}

export async function* readNdjson(filePath) {
	const input = createReadStream(filePath);
	const lines = createInterface({ input, crlfDelay: Number.POSITIVE_INFINITY });
	try {
		for await (const line of lines) {
			if (line.trim()) yield JSON.parse(line);
		}
	} finally {
		lines.close();
		input.destroy();
	}
}

export function streamReplay(res, filePath, { head = false } = {}) {
	res.writeHead(200, {
		"Content-Type": "application/x-ndjson; charset=utf-8",
		"Cache-Control": "no-store",
	});
	if (head) {
		res.end();
		return Promise.resolve();
	}
	return pipeline(createReadStream(filePath), res);
}
