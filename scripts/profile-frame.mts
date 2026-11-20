import { mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { type CDPSession, chromium } from "@playwright/test";
import { loadConfig } from "../server/src/config.ts";
import { createApp } from "../server/src/index.ts";

interface CpuProfileNode {
	id: number;
	parent?: number;
	callFrame?: {
		functionName?: string;
		url?: string;
		lineNumber?: number;
	};
	hitCount?: number;
}

interface CpuProfile {
	nodes: CpuProfileNode[];
	samples?: number[];
	startTime?: number;
	endTime?: number;
}

interface TraceEvent {
	name?: unknown;
	ph?: unknown;
	ts?: unknown;
	pid?: unknown;
	tid?: unknown;
	dur?: unknown;
	args?: unknown;
}

interface ProfileMeasure {
	name: string;
	duration: number;
}

interface LoopStatsSample {
	frameTimes: number[];
	workTimes: number[];
	framesPerSecond: number;
}

interface Summary {
	label: string;
	durationMs: number;
	bots: number;
	frames: number;
	meanFrameMs: number;
	p50FrameMs: number;
	p95FrameMs: number;
	p99FrameMs: number;
	meanWorkMs: number;
	p99WorkMs: number;
	fps: number;
	framesOver16_7: number;
	hitchesOver50ms: number;
	gc: {
		majorCount: number;
		majorMs: number;
		minorCount: number;
		minorMs: number;
		maxPauseMs: number;
	};
	sections: Record<
		string,
		{ count: number; p50Ms: number; p95Ms: number; p99Ms: number }
	>;
	hotFunctions: Array<{ name: string; selfSamples: number }>;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
	Boolean(value) && typeof value === "object" && !Array.isArray(value);

const isNumberArray = (value: unknown): value is number[] =>
	Array.isArray(value) && value.every((entry) => typeof entry === "number");

function expectCpuProfile(value: unknown): CpuProfile {
	if (!isRecord(value) || !Array.isArray(value.nodes))
		throw new Error("Profiler.stop returned no CPU profile");
	const nodes: CpuProfileNode[] = value.nodes.map((node) => {
		if (!isRecord(node) || typeof node.id !== "number")
			throw new Error("invalid CPU profile node");
		const callFrame = isRecord(node.callFrame) ? node.callFrame : undefined;
		return {
			id: node.id,
			parent: typeof node.parent === "number" ? node.parent : undefined,
			callFrame: callFrame
				? {
						functionName:
							typeof callFrame.functionName === "string"
								? callFrame.functionName
								: undefined,
						url: typeof callFrame.url === "string" ? callFrame.url : undefined,
						lineNumber:
							typeof callFrame.lineNumber === "number"
								? callFrame.lineNumber
								: undefined,
					}
				: undefined,
			hitCount: typeof node.hitCount === "number" ? node.hitCount : undefined,
		};
	});
	return {
		nodes,
		samples: isNumberArray(value.samples) ? value.samples : undefined,
		startTime:
			typeof value.startTime === "number" ? value.startTime : undefined,
		endTime: typeof value.endTime === "number" ? value.endTime : undefined,
	};
}

function expectLoopStats(value: unknown): LoopStatsSample {
	if (
		!isRecord(value) ||
		!isNumberArray(value.frameTimes) ||
		!isNumberArray(value.workTimes) ||
		typeof value.framesPerSecond !== "number"
	)
		throw new Error("invalid loop stats sample");
	return {
		frameTimes: value.frameTimes,
		workTimes: value.workTimes,
		framesPerSecond: value.framesPerSecond,
	};
}

function expectMeasures(value: unknown): ProfileMeasure[] {
	if (!Array.isArray(value)) throw new Error("expected a list of measures");
	return value.map((measure) => {
		if (
			!isRecord(measure) ||
			typeof measure.name !== "string" ||
			typeof measure.duration !== "number"
		)
			throw new Error("invalid profile measure");
		return { name: measure.name, duration: measure.duration };
	});
}

function option(name: string, fallback: string): string {
	const prefix = `--${name}=`;
	const found = process.argv.find((arg) => arg.startsWith(prefix));
	return found ? found.slice(prefix.length) : fallback;
}

function percentile(values: readonly number[], p: number): number {
	if (values.length === 0) return 0;
	const sorted = [...values].sort((a, b) => a - b);
	const index = Math.min(sorted.length - 1, Math.ceil(p * sorted.length) - 1);
	return sorted[index] ?? 0;
}

function mean(values: readonly number[]): number {
	if (values.length === 0) return 0;
	return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function summarize(
	name: string,
	values: readonly number[],
): [string, Summary["sections"][string]] {
	return [
		name,
		{
			count: values.length,
			p50Ms: percentile(values, 0.5),
			p95Ms: percentile(values, 0.95),
			p99Ms: percentile(values, 0.99),
		},
	];
}

function gcSummary(events: readonly TraceEvent[]): Summary["gc"] {
	const majorNames = new Set(["MajorGC", "MarkCompact", "V8.GCCompactor"]);
	const minorNames = new Set(["MinorGC", "Scavenge", "V8.GCScavenger"]);
	const pauses: Array<{
		name: string;
		ts: number;
		duration: number;
		tid: string;
	}> = [];
	const begins = new Map<string, TraceEvent>();
	for (const event of events) {
		const name = typeof event.name === "string" ? event.name : "";
		const key = `${name}:${String(event.tid)}`;
		if (event.ph === "B") {
			begins.set(key, event);
			continue;
		}
		let ts = typeof event.ts === "number" ? event.ts : null;
		let duration = typeof event.dur === "number" ? event.dur : 0;
		if (event.ph === "E") {
			const begin = begins.get(key);
			if (!begin || typeof begin.ts !== "number") continue;
			ts = begin.ts;
			duration =
				ts === null
					? 0
					: event.ts !== undefined && typeof event.ts === "number"
						? event.ts - begin.ts
						: 0;
			begins.delete(key);
		}
		if (ts === null || (!majorNames.has(name) && !minorNames.has(name)))
			continue;
		pauses.push({ name, ts, duration, tid: String(event.tid) });
	}
	const groups = new Map<string, typeof pauses>();
	for (const pause of pauses) {
		const key = `${Math.round(pause.ts / 1000)}:${pause.tid}`;
		const group = groups.get(key) ?? [];
		group.push(pause);
		groups.set(key, group);
	}
	let majorCount = 0;
	let majorMs = 0;
	let minorCount = 0;
	let minorMs = 0;
	let maxPauseMs = 0;
	for (const group of groups.values()) {
		const major = group.find((pause) => majorNames.has(pause.name));
		const minor =
			group.find((pause) => pause.name === "MinorGC") ??
			group.find((pause) => minorNames.has(pause.name));
		const pause = major ?? minor;
		if (!pause) continue;
		const duration = pause.duration / 1000;
		if (!Number.isFinite(duration) || duration <= 0) continue;
		if (major) {
			majorCount += 1;
			majorMs += duration;
		} else {
			minorCount += 1;
			minorMs += duration;
		}
		maxPauseMs = Math.max(maxPauseMs, duration);
	}
	return { majorCount, majorMs, minorCount, minorMs, maxPauseMs };
}

function gcLogSummary(text: string): Summary["gc"] {
	let majorCount = 0;
	let majorMs = 0;
	let minorCount = 0;
	let minorMs = 0;
	let maxPauseMs = 0;
	for (const line of text.split("\n")) {
		const match =
			/^\s*\[[^\]]+\]\s*([0-9.]+)\s*ms:\s*(.+?)\s+\d+(?:\.\d+)?\s+\(/.exec(
				line,
			);
		if (!match) continue;
		const duration = Number(match[1]);
		const type = match[2] ?? "";
		if (!Number.isFinite(duration)) continue;
		const major = /mark-compact|mark-sweep|major/i.test(type);
		if (major) {
			majorCount += 1;
			majorMs += duration;
		} else {
			minorCount += 1;
			minorMs += duration;
		}
		maxPauseMs = Math.max(maxPauseMs, duration);
	}
	return { majorCount, majorMs, minorCount, minorMs, maxPauseMs };
}

function hotFunctions(profile: CpuProfile): Summary["hotFunctions"] {
	const samples = new Map<number, number>();
	for (const id of profile.samples ?? [])
		samples.set(id, (samples.get(id) ?? 0) + 1);
	return profile.nodes
		.map((node) => ({
			name:
				node.callFrame?.functionName ||
				node.callFrame?.url?.split("/").pop() ||
				`(node ${node.id})`,
			selfSamples: samples.get(node.id) ?? node.hitCount ?? 0,
		}))
		.filter((entry) => entry.selfSamples > 0)
		.sort((a, b) => b.selfSamples - a.selfSamples)
		.slice(0, 12);
}

function escapeXml(value: string): string {
	return value.replace(/[<>&"']/g, (character) => {
		if (character === "<") return "&lt;";
		if (character === ">") return "&gt;";
		if (character === "&") return "&amp;";
		if (character === '"') return "&quot;";
		return "&apos;";
	});
}

function flameGraph(profile: CpuProfile): string {
	const byId = new Map(profile.nodes.map((node) => [node.id, node]));
	const samples = new Map<number, number>();
	for (const id of profile.samples ?? [])
		samples.set(id, (samples.get(id) ?? 0) + 1);
	const children = new Map<number, CpuProfileNode[]>();
	const roots: CpuProfileNode[] = [];
	for (const node of profile.nodes) {
		if (node.parent === undefined || !byId.has(node.parent)) {
			roots.push(node);
			continue;
		}
		const siblings = children.get(node.parent) ?? [];
		siblings.push(node);
		children.set(node.parent, siblings);
	}
	const totals = new Map<number, number>();
	const totalOf = (node: CpuProfileNode): number => {
		const cached = totals.get(node.id);
		if (cached !== undefined) return cached;
		const self = samples.get(node.id) ?? node.hitCount ?? 0;
		const nested = (children.get(node.id) ?? []).reduce(
			(sum, child) => sum + totalOf(child),
			0,
		);
		const total = self + nested;
		totals.set(node.id, total);
		return total;
	};
	const rootTotal = roots.reduce((sum, node) => sum + totalOf(node), 0) || 1;
	const rowHeight = 20;
	const width = 1200;
	const height = rowHeight * 14;
	const rects: string[] = [];
	const palette = [
		"#2563eb",
		"#0891b2",
		"#059669",
		"#65a30d",
		"#ca8a04",
		"#ea580c",
		"#db2777",
	];
	let colorIndex = 0;
	const draw = (node: CpuProfileNode, x: number, depth: number): void => {
		if (depth >= 14 || x >= width) return;
		const nodeTotal = totalOf(node);
		const nodeWidth = (nodeTotal / rootTotal) * width;
		if (nodeWidth < 0.5) return;
		const name = node.callFrame?.functionName || "(anonymous)";
		const file = node.callFrame?.url?.split("/").pop() ?? "";
		const label = `${name} ${file}`.trim();
		const y = height - (depth + 1) * rowHeight;
		const color = palette[colorIndex++ % palette.length] ?? "#2563eb";
		rects.push(
			`<rect x="${x.toFixed(2)}" y="${y}" width="${nodeWidth.toFixed(2)}" height="${rowHeight - 2}" fill="${color}" stroke="#0f172a"/>`,
		);
		if (nodeWidth > 48) {
			rects.push(
				`<text x="${(x + 4).toFixed(2)}" y="${y + 14}" fill="#f8fafc" font-family="monospace" font-size="11">${escapeXml(label.slice(0, Math.floor(nodeWidth / 7)))}</text>`,
			);
		}
		let nextX = x;
		for (const child of [...(children.get(node.id) ?? [])].sort(
			(a, b) => totalOf(b) - totalOf(a),
		)) {
			draw(child, nextX, depth + 1);
			nextX += (totalOf(child) / rootTotal) * width;
		}
	};
	for (const root of [...roots].sort((a, b) => totalOf(b) - totalOf(a)))
		draw(root, 0, 0);
	return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}"><rect width="100%" height="100%" fill="#0f172a"/>${rects.join("")}</svg>`;
}

async function traceEvents(
	cdp: CDPSession,
	action: () => Promise<void>,
): Promise<TraceEvent[]> {
	const complete = new Promise<string | null>((done) => {
		cdp.once("Tracing.tracingComplete", (payload: unknown) => {
			if (!isRecord(payload) || typeof payload.stream !== "string") {
				done(null);
				return;
			}
			done(payload.stream);
		});
	});
	await cdp.send("Tracing.start", {
		categories:
			"devtools.timeline,disabled-by-default-devtools.timeline,v8,disabled-by-default-v8.gc",
		transferMode: "ReturnAsStream",
	});
	await action();
	await cdp.send("Tracing.end");
	const stream = await complete;
	if (!stream) return [];
	let raw = "";
	while (true) {
		const chunk: unknown = await cdp.send("IO.read", {
			handle: stream,
			size: 1024 * 1024,
		});
		if (
			!isRecord(chunk) ||
			typeof chunk.data !== "string" ||
			typeof chunk.eof !== "boolean"
		)
			throw new Error("invalid IO.read response");
		raw += chunk.data;
		if (chunk.eof) break;
	}
	const parsed: unknown = JSON.parse(raw);
	if (!isRecord(parsed) || !Array.isArray(parsed.traceEvents)) return [];
	return parsed.traceEvents.filter((event): event is TraceEvent =>
		isRecord(event),
	);
}

async function main(): Promise<void> {
	const label = option("label", "before");
	const durationMs = Number(option("duration", "30000"));
	const botCount = Number(option("bots", "8"));
	const port = Number(option("port", "3199"));
	const outDir = resolve(option("out", `docs/assets/lab-07-profile-${label}`));
	const gcLog = resolve(outDir, `lab-07-gc-${label}.log`);
	await mkdir(outDir, { recursive: true });
	await rm(gcLog, { force: true });
	await stat(resolve("client/dist/index.html"));
	process.env.PROFILE = "1";
	const config = {
		...loadConfig({}),
		host: "127.0.0.1",
		port,
		logDir: resolve(`.logs/profile-${label}`),
		pingIntervalMs: 60000,
	};
	const app = await createApp(config);
	await app.listen();
	const browser = await chromium.launch({
		headless: true,
		args: [`--js-flags=--trace-gc,--logfile=${gcLog}`],
	});
	let summary: Summary | null = null;
	try {
		const response = await fetch(
			`http://127.0.0.1:${port}/api/rooms/training/bots`,
			{
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({ count: botCount }),
			},
		);
		if (!response.ok)
			throw new Error(`bots endpoint returned ${response.status}`);
		const context = await browser.newContext({
			viewport: { width: 1280, height: 720 },
		});
		const page = await context.newPage();
		await page.goto(`http://127.0.0.1:${port}/?debug&profile`);
		await page.locator(".join-form [name=name]").fill("Profiler");
		await page.locator(".join-form [name=room]").selectOption("training");
		await page.locator('.join-form button[type="submit"]').click();
		await page.locator(".start").click();
		await page.locator(".game-chat").waitFor();
		await page.waitForFunction(() =>
			Boolean(window.__dogfight?.predictor.visualPos),
		);
		await page.evaluate(() => window.__dogfight?.profile.clear());
		const cdp = await context.newCDPSession(page);
		const browserCdp = await browser.newBrowserCDPSession();
		await cdp.send("Profiler.enable");
		await cdp.send("Profiler.setSamplingInterval", { interval: 250 });
		await cdp.send("Profiler.start");
		await page.keyboard.down("ArrowUp");
		await page.keyboard.down("Space");
		const events = await traceEvents(browserCdp, async () => {
			await page.waitForTimeout(durationMs);
		});
		await page.keyboard.up("Space");
		await page.keyboard.up("ArrowUp");
		const stoppedRaw: unknown = await cdp.send("Profiler.stop");
		if (!isRecord(stoppedRaw))
			throw new Error("invalid Profiler.stop response");
		const profile = expectCpuProfile(stoppedRaw.profile);
		const loopRaw: unknown = await page.evaluate(() => ({
			frameTimes: [...(window.__dogfight?.loop.stats.frameTimes ?? [])],
			workTimes: [...(window.__dogfight?.loop.stats.workTimes ?? [])],
			framesPerSecond: window.__dogfight?.loop.stats.framesPerSecond ?? 0,
		}));
		const loop = expectLoopStats(loopRaw);
		const browserMeasuresRaw: unknown = await page.evaluate(
			() => window.__dogfight?.profile.measures() ?? [],
		);
		const browserMeasures = expectMeasures(browserMeasuresRaw);
		const serverMeasuresRaw: unknown = await (
			await fetch(`http://127.0.0.1:${port}/api/profile`)
		).json();
		if (!isRecord(serverMeasuresRaw))
			throw new Error("invalid /api/profile response");
		const serverMeasures = {
			measures: expectMeasures(serverMeasuresRaw.measures),
		};
		await page.screenshot({
			path: resolve(outDir, `lab-07-profile-${label}.png`),
			fullPage: true,
		});
		await writeFile(
			resolve(outDir, `lab-07-cpu-${label}.cpuprofile.json`),
			JSON.stringify(profile, null, 2),
		);
		await writeFile(
			resolve(outDir, `lab-07-flame-${label}.svg`),
			flameGraph(profile),
		);
		await writeFile(
			resolve(outDir, `lab-07-frames-${label}.csv`),
			[
				"frame_ms,work_ms",
				...loop.frameTimes.map(
					(value, index) => `${value},${loop.workTimes[index] ?? 0}`,
				),
			].join("\n"),
		);
		await writeFile(
			resolve(outDir, `lab-07-events-${label}.json`),
			JSON.stringify(events, null, 2),
		);
		const grouped = new Map<string, number[]>();
		for (const measure of [...browserMeasures, ...serverMeasures.measures]) {
			const values = grouped.get(measure.name) ?? [];
			values.push(measure.duration);
			grouped.set(measure.name, values);
		}
		summary = {
			label,
			durationMs,
			bots: botCount,
			frames: loop.frameTimes.length,
			meanFrameMs: mean(loop.frameTimes),
			p50FrameMs: percentile(loop.frameTimes, 0.5),
			p95FrameMs: percentile(loop.frameTimes, 0.95),
			p99FrameMs: percentile(loop.frameTimes, 0.99),
			meanWorkMs: mean(loop.workTimes),
			p99WorkMs: percentile(loop.workTimes, 0.99),
			fps: loop.framesPerSecond,
			framesOver16_7: loop.frameTimes.filter((value) => value > 16.7).length,
			hitchesOver50ms: loop.frameTimes.filter((value) => value > 50).length,
			gc: gcSummary(events),
			sections: Object.fromEntries(
				[...grouped.entries()]
					.sort(([a], [b]) => a.localeCompare(b))
					.map(([name, values]) => summarize(name, values)),
			),
			hotFunctions: hotFunctions(profile),
		};
		await context.close();
	} finally {
		await browser.close();
		await app.close();
	}
	if (!summary) throw new Error("profile summary was not produced");
	const gcText = await readFile(gcLog, "utf8").catch(() => "");
	const fromLog = gcLogSummary(gcText);
	await writeFile(gcLog, gcText);
	if (fromLog.majorCount + fromLog.minorCount > 0) summary.gc = fromLog;
	await writeFile(
		resolve(outDir, `lab-07-summary-${label}.json`),
		JSON.stringify(summary, null, 2),
	);
	console.log(JSON.stringify(summary, null, 2));
}

await main();
