import { execFileSync } from "node:child_process";
import type { IncomingMessage, ServerResponse } from "node:http";
import type { Plugin, PreviewServer, ViteDevServer } from "vite";
import { defineConfig } from "vite";
import { VitePWA } from "vite-plugin-pwa";

let flakyAttempts = 0;

function buildVersion(): string {
	const explicit = process.env.VERSION ?? process.env.GIT_SHA;
	if (explicit) return explicit;
	try {
		return execFileSync("git", ["rev-parse", "--short", "HEAD"], {
			encoding: "utf8",
		}).trim();
	} catch {
		return "dev";
	}
}

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
	define: { __APP_VERSION__: JSON.stringify(buildVersion()) },
	plugins: [
		debugAssets,
		VitePWA({
			registerType: "autoUpdate",
			includeAssets: ["favicon.svg", "assets/sprites.png"],
			manifest: {
				name: "Dogfight — онлайн арена",
				short_name: "Dogfight",
				description: "Багатокористувацька аркада з живим WebSocket-боєм.",
				lang: "uk",
				theme_color: "#0f172a",
				background_color: "#0f172a",
				display: "standalone",
				start_url: "/",
				icons: [
					{
						src: "/icons/icon-192.png",
						sizes: "192x192",
						type: "image/png",
						purpose: "any",
					},
					{
						src: "/icons/icon-512.png",
						sizes: "512x512",
						type: "image/png",
						purpose: "any maskable",
					},
				],
			},
			workbox: {
				globPatterns: ["**/*.{js,css,html,svg,png,ico,json,wav,webmanifest}"],
				navigateFallback: "/index.html",
				runtimeCaching: [
					{
						urlPattern: /\/api\/rooms/,
						handler: "NetworkFirst",
						options: {
							cacheName: "dogfight-rooms",
							networkTimeoutSeconds: 3,
							expiration: { maxEntries: 10, maxAgeSeconds: 300 },
						},
					},
				],
			},
		}),
	],
	server: { proxy },
	preview: { proxy },
});
