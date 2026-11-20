import { createReadStream } from "node:fs";
import { readdir, stat } from "node:fs/promises";
import type { ServerResponse } from "node:http";
import { resolve, sep } from "node:path";
import { createInterface } from "node:readline";
import { pipeline } from "node:stream/promises";

const REPLAY_ID = /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/;

function invalid(message: string, status = 400): Error & { status: number } {
	return Object.assign(new Error(message), { status });
}

export function replayPath(logDir: string, id: unknown): string {
	const value = String(id ?? "");
	if (!REPLAY_ID.test(value)) throw invalid("invalid replay id");
	const filePath = resolve(logDir, `${value}.ndjson`);
	if (!filePath.startsWith(`${logDir}${sep}`))
		throw invalid("invalid replay path");
	return filePath;
}

export interface ReplayInfo {
	id: string;
	bytes: number;
	modified: string;
}

export async function listReplays(logDir: string): Promise<ReplayInfo[]> {
	const entries = await readdir(logDir);
	const files = entries.filter((entry) => entry.endsWith(".ndjson"));
	const details = await Promise.all(
		files.map(async (file): Promise<ReplayInfo> => {
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

export async function* readNdjson(filePath: string): AsyncGenerator<unknown> {
	const input = createReadStream(filePath);
	const lines = createInterface({ input, crlfDelay: Number.POSITIVE_INFINITY });
	try {
		for await (const line of lines) {
			if (line.trim()) {
				const value: unknown = JSON.parse(line);
				yield value;
			}
		}
	} finally {
		lines.close();
		input.destroy();
	}
}

export function streamReplay(
	res: ServerResponse,
	filePath: string,
	{ head = false }: { head?: boolean } = {},
): Promise<void> {
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
