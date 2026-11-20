const DEFAULT_ATTEMPTS = 3;
const DEFAULT_BASE_MS = 250;

const isRecord = (value: unknown): value is Record<string, unknown> =>
	typeof value === "object" && value !== null && !Array.isArray(value);

function errorName(error: unknown): string | undefined {
	return isRecord(error) && typeof error.name === "string"
		? error.name
		: undefined;
}

export class HttpError extends Error {
	readonly status: number;

	constructor(status: number, url: string) {
		super(`HTTP ${status} for ${url}`);
		this.name = "HttpError";
		this.status = status;
	}
}

export function isClientError(error: unknown): boolean {
	return (
		error instanceof HttpError && error.status >= 400 && error.status < 500
	);
}

export function isCancellation(error: unknown): boolean {
	const name = errorName(error);
	return name === "AbortError" || name === "TimeoutError";
}

export function isRetryable(error: unknown): boolean {
	if (isCancellation(error) || isClientError(error)) return false;
	if (error instanceof HttpError) {
		return error.status === 429 || error.status >= 500;
	}
	const name = errorName(error);
	return name === "TypeError" || name === "NetworkError";
}

function abortError(message = "Aborted") {
	return new DOMException(message, "AbortError");
}

function combinedSignal(
	signal: AbortSignal | null | undefined,
	timeoutMs: number | undefined,
): AbortSignal | null {
	const signals: AbortSignal[] = [];
	if (signal) signals.push(signal);
	if (timeoutMs) signals.push(AbortSignal.timeout(timeoutMs));
	if (signals.length > 1) return AbortSignal.any(signals);
	return signals[0] ?? null;
}

export function wait(ms: number, signal?: AbortSignal | null): Promise<void> {
	return new Promise<void>((resolve, reject) => {
		if (signal?.aborted) {
			reject(signal.reason ?? abortError());
			return;
		}

		const timer = setTimeout(() => {
			signal?.removeEventListener("abort", onAbort);
			resolve();
		}, ms);

		function onAbort() {
			clearTimeout(timer);
			reject(signal?.reason ?? abortError());
		}

		signal?.addEventListener("abort", onAbort, { once: true });
	});
}

export interface LoadOptions {
	attempts?: number;
	baseMs?: number;
	signal?: AbortSignal | null;
	timeoutMs?: number;
}

export async function withRetry<T>(
	load: (attempt: number) => Promise<T> | T,
	{
		attempts = DEFAULT_ATTEMPTS,
		baseMs = DEFAULT_BASE_MS,
		signal,
	}: LoadOptions = {},
): Promise<T> {
	for (let attempt = 1; ; attempt++) {
		try {
			return await load(attempt);
		} catch (error) {
			if (isCancellation(error) || !isRetryable(error) || attempt >= attempts) {
				throw error;
			}
			const backoff = baseMs * 2 ** (attempt - 1);
			const jitter = backoff * (0.5 + Math.random() * 0.5);
			await wait(jitter, signal);
		}
	}
}

async function fetchResponse(
	url: string,
	{ signal, timeoutMs }: LoadOptions = {},
): Promise<Response> {
	const response = await fetch(url, {
		signal: combinedSignal(signal, timeoutMs) ?? undefined,
	});
	if (!response.ok) throw new HttpError(response.status, url);
	return response;
}

export async function fetchJson(
	url: string,
	options: LoadOptions = {},
): Promise<unknown> {
	const response = await fetchResponse(url, options);
	try {
		return await response.json();
	} catch (cause) {
		throw new Error(`Invalid JSON in ${url}`, { cause });
	}
}

export function loadJson(
	url: string,
	options: LoadOptions = {},
): Promise<unknown> {
	return withRetry(() => fetchJson(url, options), options);
}

export function loadImage(
	src: string,
	options: LoadOptions = {},
): Promise<HTMLImageElement> {
	return withRetry(async () => {
		const response = await fetchResponse(src, options);
		const blob = await response.blob();
		const objectUrl = URL.createObjectURL(blob);

		let onAbort = () => {};
		try {
			return await new Promise<HTMLImageElement>((resolve, reject) => {
				const image = new Image();
				const cleanup = () => {
					image.onload = null;
					image.onerror = null;
					options.signal?.removeEventListener("abort", onAbort);
				};

				image.onload = () => {
					cleanup();
					resolve(image);
				};
				image.onerror = () => {
					cleanup();
					reject(new Error(`failed to decode ${src}`));
				};
				onAbort = () => {
					cleanup();
					image.src = "";
					reject(options.signal?.reason ?? abortError());
				};
				options.signal?.addEventListener("abort", onAbort, { once: true });
				image.src = objectUrl;
			});
		} finally {
			URL.revokeObjectURL(objectUrl);
		}
	}, options);
}

export function loadAudio(
	ctx: BaseAudioContext | null | undefined,
	url: string,
	options: LoadOptions = {},
): Promise<AudioBuffer> {
	return withRetry(async () => {
		if (!ctx) throw new TypeError("audio context is unavailable");
		const response = await fetchResponse(url, options);
		const bytes = await response.arrayBuffer();
		const buffer = await ctx.decodeAudioData(bytes);
		if (options.signal?.aborted) throw options.signal.reason ?? abortError();
		return buffer;
	}, options);
}

export interface AssetManifest {
	sprites?: Record<string, string>;
	sounds?: Record<string, string>;
	arena?: string;
	rooms?: string;
}

export type AssetGroup = "sprites" | "sounds" | "arena" | "extras";

export interface LoadJob {
	name: string;
	group: AssetGroup;
	required: boolean;
	fallback?: unknown;
	load(): Promise<unknown>;
}

export interface LoadFailure {
	name: string;
	group: AssetGroup;
	error: unknown;
}

export interface LoadProgress extends LoadFailure {
	done: number;
	total: number;
}

export interface LoadedAssets {
	sprites: Record<string, unknown>;
	sounds: Record<string, unknown>;
	arena: unknown;
	extras: Record<string, unknown>;
	failures: LoadFailure[];
}

function manifestJobs(
	manifest: AssetManifest,
	{
		ctx,
		signal,
	}: {
		ctx: BaseAudioContext | null | undefined;
		signal: AbortSignal | null | undefined;
	},
): LoadJob[] {
	const jobs: LoadJob[] = [];

	for (const [name, src] of Object.entries(manifest.sprites ?? {})) {
		jobs.push({
			name,
			group: "sprites",
			required: true,
			load: () => loadImage(src, { signal }),
		});
	}
	for (const [name, src] of Object.entries(manifest.sounds ?? {})) {
		jobs.push({
			name,
			group: "sounds",
			required: false,
			fallback: null,
			load: () => loadAudio(ctx, src, { signal }),
		});
	}
	if (manifest.arena) {
		jobs.push({
			name: "arena",
			group: "arena",
			required: false,
			fallback: null,
			load: () => loadJson(manifest.arena ?? "", { signal }),
		});
	}

	return jobs;
}

export interface LoadAllOptions extends LoadOptions {
	ctx?: BaseAudioContext;
	extra?: LoadJob[];
	onProgress?: (progress: LoadProgress) => void;
	sequential?: boolean;
}

export async function loadAll(
	manifest: AssetManifest,
	{
		ctx,
		extra = [],
		onProgress,
		signal,
		sequential = false,
	}: LoadAllOptions = {},
): Promise<LoadedAssets> {
	const jobs = [...manifestJobs(manifest, { ctx, signal }), ...extra];
	const result: LoadedAssets = {
		sprites: {},
		sounds: {},
		arena: null,
		extras: {},
		failures: [],
	};
	let done = 0;

	function store(job: LoadJob, value: unknown) {
		if (job.group === "arena") result.arena = value;
		else if (job.group === "sprites" || job.group === "sounds")
			result[job.group][job.name] = value;
		else result.extras[job.name] = value;
	}

	async function run(job: LoadJob): Promise<unknown> {
		let value: unknown = job.fallback ?? null;
		let error: unknown = null;
		try {
			value = await job.load();
		} catch (cause) {
			if (job.required || signal?.aborted) throw cause;
			error = cause;
			result.failures.push({ name: job.name, group: job.group, error: cause });
		}

		done++;
		onProgress?.({
			done,
			total: jobs.length,
			name: job.name,
			group: job.group,
			error,
		});
		store(job, value);
		return value;
	}

	const tracked = jobs.map(run);
	if (sequential) {
		for (const job of tracked) await job;
	} else {
		await Promise.all(tracked);
	}

	return result;
}
