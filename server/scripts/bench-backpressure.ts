import { createWriteStream } from "node:fs";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { loadConfig, rootDir } from "../src/config.ts";
import { createApp } from "../src/index.ts";

interface RssSample {
	t: number;
	rss: number;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
	Boolean(value) && typeof value === "object" && !Array.isArray(value);

const targetBytes = Number(process.env.BENCH_BYTES ?? 200 * 1024 * 1024);
const throttleMs = Number(process.env.BENCH_THROTTLE_MS ?? 16);
const sampleMs = Number(process.env.BENCH_SAMPLE_MS ?? 250);
const assetsDir = resolve(rootDir, "docs/assets");
const sleep = (ms: number): Promise<void> =>
	new Promise<void>((resolveSleep) => setTimeout(resolveSleep, ms));

async function fetchRss(base: string): Promise<number> {
	const response = await fetch(`${base}/health`);
	const health: unknown = await response.json();
	if (!isRecord(health) || typeof health.rss !== "number")
		throw new Error("invalid health response");
	return health.rss;
}

function renderSvg(samples: readonly RssSample[], bytes: number): string {
	const width = 900;
	const height = 420;
	const left = 70;
	const right = 24;
	const top = 58;
	const bottom = 54;
	const minT = 0;
	const maxT = Math.max(1, ...samples.map((sample) => sample.t));
	const values = samples.map((sample) => sample.rss / 1024 / 1024);
	const minY = Math.floor(Math.min(...values));
	const maxY = Math.ceil(Math.max(...values));
	const spanY = Math.max(1, maxY - minY);
	const x = (t: number): number =>
		left + ((t - minT) / (maxT - minT)) * (width - left - right);
	const y = (rss: number): number =>
		top + (1 - (rss / 1024 / 1024 - minY) / spanY) * (height - top - bottom);
	const points = samples.map(
		(sample) => `${x(sample.t).toFixed(1)},${y(sample.rss).toFixed(1)}`,
	);
	const yTicks = Array.from({ length: 5 }, (_, index) => {
		const value = minY + (index * spanY) / 4;
		return `<line x1="${left}" y1="${y(value * 1024 * 1024).toFixed(1)}" x2="${width - right}" y2="${y(value * 1024 * 1024).toFixed(1)}" stroke="#e2e8f0" stroke-opacity="0.18"/><text x="${left - 10}" y="${(y(value * 1024 * 1024) + 4).toFixed(1)}" fill="#94a3b8" font-size="12" text-anchor="end">${value.toFixed(0)}</text>`;
	}).join("\n");
	const xTicks = Array.from({ length: 5 }, (_, index) => {
		const time = (index * maxT) / 4;
		return `<text x="${x(time).toFixed(1)}" y="${height - bottom + 22}" fill="#94a3b8" font-size="12" text-anchor="middle">${(time / 1000).toFixed(0)}s</text>`;
	}).join("\n");
	return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img" aria-label="Server RSS while streaming a large replay">
<rect width="${width}" height="${height}" fill="#0b0f1a"/>
<text x="${left}" y="30" fill="#4ade80" font-family="monospace" font-size="17">Lab 04 - server RSS, throttled replay (pipeline)</text>
<text x="${left}" y="48" fill="#94a3b8" font-family="monospace" font-size="12">${(bytes / 1024 / 1024).toFixed(0)} MB NDJSON, RSS in MB, flat = backpressure handled</text>
${yTicks}
${xTicks}
<polyline fill="none" stroke="#22d3ee" stroke-width="2.5" points="${points.join(" ")}"/>
</svg>`;
}

async function* generateLines(totalBytes: number): AsyncGenerator<string> {
	let written = 0;
	let sequence = 0;
	const text = "x".repeat(160);
	while (written < totalBytes) {
		const line = `${JSON.stringify({
			t: new Date().toISOString(),
			seq: ++sequence,
			type: "chat",
			room: "bench",
			player: { id: "bench", name: "BENCH" },
			text,
		})}\n`;
		written += Buffer.byteLength(line);
		yield line;
	}
	console.log(`[bench] generated ${(written / 1024 / 1024).toFixed(0)} MB`);
}

await mkdir(assetsDir, { recursive: true });
const config = { ...loadConfig(process.env), port: 0 };
const app = await createApp(config);
await app.listen();
const address = app.server.address();
if (!address || typeof address === "string")
	throw new Error("server has no TCP port");
const port = address.port;
const base = `http://${config.host}:${port}`;
const id = `bench-${Date.now()}`;
const filePath = resolve(config.logDir, `${id}.ndjson`);
const samples: RssSample[] = [];
let sampling: NodeJS.Timeout | null = null;

try {
	await pipeline(
		Readable.from(generateLines(targetBytes)),
		createWriteStream(filePath),
	);
	const started = Date.now();
	sampling = setInterval(() => {
		void fetchRss(base)
			.then((rss) => samples.push({ t: Date.now() - started, rss }))
			.catch(() => {});
	}, sampleMs);

	const response = await fetch(`${base}/api/replays/${id}`);
	if (!response.ok) throw new Error(`replay failed: HTTP ${response.status}`);
	const body = response.body;
	if (!body) throw new Error("replay response has no body");
	const reader = body.getReader();
	let received = 0;
	while (true) {
		const { done, value } = await reader.read();
		if (done) break;
		received += value.byteLength;
		await sleep(throttleMs);
	}
	if (sampling) clearInterval(sampling);
	sampling = null;
	samples.push({
		t: Date.now() - started,
		rss: await fetchRss(base),
	});

	const csv = ["t_ms,rss_bytes", ...samples.map((s) => `${s.t},${s.rss}`)].join(
		"\n",
	);
	await writeFile(resolve(assetsDir, "lab-04-rss.csv"), `${csv}\n`);
	await writeFile(
		resolve(assetsDir, "lab-04-rss.svg"),
		renderSvg(samples, targetBytes),
	);
	console.log(
		`[bench] streamed ${(received / 1024 / 1024).toFixed(0)} MB in ${((Date.now() - started) / 1000).toFixed(1)} s, ${samples.length} samples`,
	);
} finally {
	if (sampling) clearInterval(sampling);
	await app.close();
	await rm(filePath, { force: true });
}
