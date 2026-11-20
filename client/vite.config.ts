import type { IncomingMessage, ServerResponse } from "node:http";
import type { Plugin, PreviewServer, ViteDevServer } from "vite";
import { defineConfig } from "vite";

let flakyAttempts = 0;

function debugMiddleware(
	req: IncomingMessage,
	res: ServerResponse,
	next: (error?: unknown) => void,
): void {
	const pathname = new URL(req.url ?? "/", "http://localhost").pathname;

	if (pathname === "/debug/slow") {
		setTimeout(() => {
			res.setHeader("Content-Type", "application/json");
			res.end(JSON.stringify({ label: "slow asset", ok: true }));
		}, 2500);
		return;
	}
	if (pathname === "/debug/badjson") {
		res.setHeader("Content-Type", "application/json");
		res.end("{ this is not json");
		return;
	}
	if (pathname === "/debug/404") {
		res.statusCode = 404;
		res.end("not found");
		return;
	}
	if (pathname === "/debug/flaky") {
		flakyAttempts++;
		if (flakyAttempts <= 2) {
			res.statusCode = 503;
			res.end("try again");
			return;
		}
		res.setHeader("Content-Type", "application/json");
		res.end(JSON.stringify({ ok: true, attempts: flakyAttempts }));
		return;
	}
	next();
}

const debugAssets: Plugin = {
	name: "lab-03-debug-assets",
	configureServer(server: ViteDevServer) {
		server.middlewares.use(debugMiddleware);
	},
	configurePreviewServer(server: PreviewServer) {
		server.middlewares.use(debugMiddleware);
	},
};

const serverPort = process.env.PORT ?? "3001";
const proxy = {
	"/api": `http://127.0.0.1:${serverPort}`,
	"/ws": { target: `ws://127.0.0.1:${serverPort}`, ws: true },
};

export default defineConfig({
	plugins: [debugAssets],
	server: { proxy },
	preview: { proxy },
});
