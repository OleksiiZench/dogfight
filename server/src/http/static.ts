import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import type { IncomingMessage, ServerResponse } from "node:http";
import { extname, resolve, sep } from "node:path";
import { pipeline } from "node:stream/promises";

const MIME: Record<string, string> = {
	".html": "text/html; charset=utf-8",
	".js": "text/javascript; charset=utf-8",
	".mjs": "text/javascript; charset=utf-8",
	".ts": "text/javascript; charset=utf-8",
	".css": "text/css; charset=utf-8",
	".json": "application/json; charset=utf-8",
	".webmanifest": "application/manifest+json",
	".ndjson": "application/x-ndjson; charset=utf-8",
	".svg": "image/svg+xml",
	".png": "image/png",
	".ico": "image/x-icon",
	".wav": "audio/wav",
	".map": "application/json; charset=utf-8",
};

function fail(res: ServerResponse, status: number, message: string): void {
	res.writeHead(status, { "Content-Type": "text/plain; charset=utf-8" });
	res.end(message);
}

export async function serveStatic(
	req: IncomingMessage,
	res: ServerResponse,
	root: string,
): Promise<void> {
	if (req.method !== "GET" && req.method !== "HEAD") {
		fail(res, 405, "method not allowed");
		return;
	}

	let pathname: string;
	try {
		pathname = decodeURIComponent(
			new URL(req.url ?? "/", "http://localhost").pathname,
		);
	} catch {
		fail(res, 400, "invalid path");
		return;
	}

	if (
		pathname.includes("\0") ||
		pathname.includes("\\") ||
		pathname.split("/").includes("..")
	) {
		fail(res, 403, "forbidden");
		return;
	}

	let filePath = resolve(root, `.${pathname}`);
	if (filePath !== root && !filePath.startsWith(`${root}${sep}`)) {
		fail(res, 403, "forbidden");
		return;
	}

	try {
		let info = await stat(filePath);
		if (info.isDirectory()) {
			filePath = resolve(filePath, "index.html");
			info = await stat(filePath);
		}
		if (!info.isFile()) throw new Error("not a file");

		res.writeHead(200, {
			"Content-Type":
				MIME[extname(filePath).toLowerCase()] ?? "application/octet-stream",
			"Content-Length": info.size,
			"Cache-Control": pathname.startsWith("/assets/")
				? "public, max-age=31536000, immutable"
				: "no-cache",
		});
		if (req.method === "HEAD") {
			res.end();
			return;
		}
		await pipeline(createReadStream(filePath), res);
	} catch {
		if (!res.headersSent) fail(res, 404, "not found");
		else if (!res.destroyed) res.destroy();
	}
}
