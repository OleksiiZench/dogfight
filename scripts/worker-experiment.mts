import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { performance } from "node:perf_hooks";
import { Worker } from "node:worker_threads";

interface WorkerResult {
	sum: number;
	workerMs: number;
}

interface ExperimentRow {
	megabytes: number;
	mainMs: number;
	clonePostMs: number;
	cloneRoundTripMs: number;
	transferPostMs: number;
	transferRoundTripMs: number;
	workerMs: number;
	cloneKeepsBuffer: boolean;
	transferDetachesBuffer: boolean;
}

const WORKER_SOURCE = `
const { parentPort } = require("node:worker_threads");
const { performance } = require("node:perf_hooks");
parentPort.on("message", ({ buffer }) => {
  const started = performance.now();
  const values = new Float32Array(buffer);
  let sum = 0;
  for (let index = 0; index < values.length; index++) sum += values[index];
  parentPort.postMessage({ sum, workerMs: performance.now() - started });
});
`;

const option = (name: string, fallback: string): string => {
	const prefix = `--${name}=`;
	const found = process.argv.find((arg) => arg.startsWith(prefix));
	return found ? found.slice(prefix.length) : fallback;
};

const median = (values: readonly number[]): number => {
	const sorted = [...values].sort((a, b) => a - b);
	return sorted[Math.floor(sorted.length / 2)] ?? 0;
};

const sumValues = (buffer: ArrayBuffer): number => {
	const values = new Float32Array(buffer);
	let sum = 0;
	for (let index = 0; index < values.length; index++) sum += values[index] ?? 0;
	return sum;
};

function chart(rows: readonly ExperimentRow[]): string {
	const width = 800;
	const height = 360;
	const left = 72;
	const right = 32;
	const top = 32;
	const bottom = 64;
	const maxMs = Math.max(
		1,
		...rows.flatMap((row) => [
			row.mainMs,
			row.cloneRoundTripMs,
			row.transferRoundTripMs,
		]),
	);
	const scaleX = (index: number): number =>
		left + (index / Math.max(1, rows.length - 1)) * (width - left - right);
	const scaleY = (value: number): number =>
		height - bottom - (value / (maxMs * 1.15)) * (height - top - bottom);
	const series: Array<{ label: string; color: string; values: number[] }> = [
		{
			label: "main thread",
			color: "#38bdf8",
			values: rows.map((row) => row.mainMs),
		},
		{
			label: "worker clone",
			color: "#f472b6",
			values: rows.map((row) => row.cloneRoundTripMs),
		},
		{
			label: "worker transfer",
			color: "#4ade80",
			values: rows.map((row) => row.transferRoundTripMs),
		},
	];
	const lines = series
		.map(
			(entry) =>
				`<polyline points="${entry.values
					.map(
						(value, index) =>
							`${scaleX(index).toFixed(1)},${scaleY(value).toFixed(1)}`,
					)
					.join(" ")}" fill="none" stroke="${entry.color}" stroke-width="3"/>`,
		)
		.join("");
	const labels = rows
		.map(
			(row, index) =>
				`<text x="${scaleX(index).toFixed(1)}" y="${height - bottom + 22}" text-anchor="middle" font-size="12" fill="#cbd5e1">${row.megabytes} MB</text>`,
		)
		.join("");
	const legend = series
		.map(
			(entry, index) =>
				`<rect x="${left + index * 190}" y="${top}" width="12" height="12" fill="${entry.color}"/><text x="${left + index * 190 + 18}" y="${top + 11}" font-size="12" fill="#cbd5e1">${entry.label}</text>`,
		)
		.join("");
	return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}"><rect width="100%" height="100%" fill="#0f172a"/>${legend}${lines}${labels}<text x="${width / 2}" y="${height - 16}" text-anchor="middle" font-size="13" fill="#cbd5e1">Float32Array sum: 50 MB-style buffer experiment</text></svg>`;
}

async function sendToWorker(
	worker: Worker,
	buffer: ArrayBuffer,
	transfer: boolean,
): Promise<{ result: WorkerResult; postMs: number; roundTripMs: number }> {
	const started = performance.now();
	let postStarted = started;
	return new Promise<{
		result: WorkerResult;
		postMs: number;
		roundTripMs: number;
	}>((resolveResult, reject) => {
		const timer = setTimeout(
			() =>
				reject(
					new Error(`worker ${transfer ? "transfer" : "clone"} timed out`),
				),
			30000,
		);
		const onMessage = (message: WorkerResult): void => {
			cleanup();
			resolveResult({
				result: message,
				postMs: postStarted,
				roundTripMs: performance.now() - started,
			});
		};
		const onError = (error: Error): void => {
			cleanup();
			reject(error);
		};
		const cleanup = (): void => {
			clearTimeout(timer);
			worker.off("message", onMessage);
			worker.off("error", onError);
		};
		worker.once("message", onMessage);
		worker.once("error", onError);
		postStarted = performance.now();
		if (transfer) worker.postMessage({ buffer }, [buffer]);
		else worker.postMessage({ buffer });
	});
}

async function main(): Promise<void> {
	const sizes = option("sizes", "8,32,64")
		.split(",")
		.map((value) => Number(value.trim()))
		.filter((value) => Number.isInteger(value) && value > 0);
	const repeats = Number(option("repeats", "5"));
	const outDir = resolve(option("out", "docs/assets"));
	const worker = new Worker(WORKER_SOURCE, { eval: true });
	const rows: ExperimentRow[] = [];
	try {
		for (const megabytes of sizes) {
			const bytes = megabytes * 1024 * 1024;
			const mainMs: number[] = [];
			const clonePostMs: number[] = [];
			const cloneRoundTripMs: number[] = [];
			const transferPostMs: number[] = [];
			const transferRoundTripMs: number[] = [];
			const workerMs: number[] = [];
			let cloneKeepsBuffer = true;
			let transferDetachesBuffer = false;
			for (let repeat = 0; repeat < repeats; repeat++) {
				const mainBuffer = new ArrayBuffer(bytes);
				new Float32Array(mainBuffer).fill(1);
				const started = performance.now();
				sumValues(mainBuffer);
				mainMs.push(performance.now() - started);

				const cloneBuffer = new ArrayBuffer(bytes);
				new Float32Array(cloneBuffer).fill(1);
				const clone = await sendToWorker(worker, cloneBuffer, false);
				clonePostMs.push(clone.postMs);
				cloneRoundTripMs.push(clone.roundTripMs);
				cloneKeepsBuffer &&= cloneBuffer.byteLength === bytes;
				workerMs.push(clone.result.workerMs);

				const transferBuffer = new ArrayBuffer(bytes);
				new Float32Array(transferBuffer).fill(1);
				const transfer = await sendToWorker(worker, transferBuffer, true);
				transferPostMs.push(transfer.postMs);
				transferRoundTripMs.push(transfer.roundTripMs);
				transferDetachesBuffer ||= transferBuffer.byteLength === 0;
				workerMs.push(transfer.result.workerMs);
			}
			rows.push({
				megabytes,
				mainMs: median(mainMs),
				clonePostMs: median(clonePostMs),
				cloneRoundTripMs: median(cloneRoundTripMs),
				transferPostMs: median(transferPostMs),
				transferRoundTripMs: median(transferRoundTripMs),
				workerMs: median(workerMs),
				cloneKeepsBuffer,
				transferDetachesBuffer,
			});
		}
	} finally {
		await worker.terminate();
	}

	const decision = rows.some(
		(row) => row.transferRoundTripMs + row.transferPostMs < row.mainMs,
	)
		? "go"
		: "no-go";
	const summary = { decision, rows };
	await mkdir(outDir, { recursive: true });
	await writeFile(
		resolve(outDir, "lab-07-worker.json"),
		JSON.stringify(summary, null, 2),
	);
	await writeFile(resolve(outDir, "lab-07-worker.svg"), chart(rows));
	console.log(JSON.stringify(summary, null, 2));
}

await main();
