const DEFAULT_ATTEMPTS = 3;
const DEFAULT_BASE_MS = 250;

export class HttpError extends Error {
	constructor(status, url) {
		super(`HTTP ${status} for ${url}`);
		this.name = "HttpError";
		this.status = status;
	}
}

export function isClientError(error) {
	return (
		error instanceof HttpError && error.status >= 400 && error.status < 500
	);
}

export function isCancellation(error) {
	return error?.name === "AbortError" || error?.name === "TimeoutError";
}

export function isRetryable(error) {
	if (isCancellation(error) || isClientError(error)) return false;
	if (error instanceof HttpError) {
		return error.status === 429 || error.status >= 500;
	}
	return error?.name === "TypeError" || error?.name === "NetworkError";
}

function abortError(message = "Aborted") {
	return new DOMException(message, "AbortError");
}

function combinedSignal(signal, timeoutMs) {
	const signals = [];
	if (signal) signals.push(signal);
	if (timeoutMs) signals.push(AbortSignal.timeout(timeoutMs));
	if (signals.length > 1) return AbortSignal.any(signals);
	return signals[0] ?? null;
}

export function wait(ms, signal) {
	return new Promise((resolve, reject) => {
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
			reject(signal.reason ?? abortError());
		}

		signal?.addEventListener("abort", onAbort, { once: true });
	});
}

export async function withRetry(
	load,
	{ attempts = DEFAULT_ATTEMPTS, baseMs = DEFAULT_BASE_MS, signal } = {},
) {
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

async function fetchResponse(url, { signal, timeoutMs } = {}) {
	const response = await fetch(url, {
		signal: combinedSignal(signal, timeoutMs) ?? undefined,
	});
	if (!response.ok) throw new HttpError(response.status, url);
	return response;
}

export async function fetchJson(url, options) {
	const response = await fetchResponse(url, options);
	try {
		return await response.json();
	} catch (cause) {
		throw new Error(`Invalid JSON in ${url}`, { cause });
	}
}

export function loadJson(url, options = {}) {
	return withRetry(() => fetchJson(url, options), options);
}

export function loadImage(src, options = {}) {
	return withRetry(async () => {
		const response = await fetchResponse(src, options);
		const blob = await response.blob();
		const objectUrl = URL.createObjectURL(blob);

		let onAbort = () => {};
		try {
			return await new Promise((resolve, reject) => {
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

export function loadAudio(ctx, url, options = {}) {
	return withRetry(async () => {
		const response = await fetchResponse(url, options);
		const bytes = await response.arrayBuffer();
		const buffer = await ctx.decodeAudioData(bytes);
		if (options.signal?.aborted) throw options.signal.reason ?? abortError();
		return buffer;
	}, options);
}

function manifestJobs(manifest, { ctx, signal }) {
	const jobs = [];

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
			load: () => loadJson(manifest.arena, { signal }),
		});
	}

	return jobs;
}

export async function loadAll(
	manifest,
	{ ctx, extra = [], onProgress, signal, sequential = false } = {},
) {
	const jobs = [...manifestJobs(manifest, { ctx, signal }), ...extra];
	const result = {
		sprites: {},
		sounds: {},
		arena: null,
		extras: {},
		failures: [],
	};
	let done = 0;

	function store(job, value) {
		if (job.group === "arena") result.arena = value;
		else if (job.group === "sprites" || job.group === "sounds")
			result[job.group][job.name] = value;
		else result.extras[job.name] = value;
	}

	async function run(job) {
		let value = job.fallback ?? null;
		let error = null;
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
