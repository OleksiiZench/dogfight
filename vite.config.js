import { defineConfig } from "vite";

let flakyAttempts = 0;

function debugMiddleware(req, res, next) {
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

const debugAssets = {
	name: "lab-03-debug-assets",
	configureServer(server) {
		server.middlewares.use(debugMiddleware);
	},
	configurePreviewServer(server) {
		server.middlewares.use(debugMiddleware);
	},
};

export default defineConfig({ plugins: [debugAssets] });
