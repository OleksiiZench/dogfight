import { describe, expect, it, vi } from "vitest";
import { HttpError, loadAll, withRetry } from "../src/assets/loader.ts";

describe("withRetry", () => {
	it("does not retry client errors", async () => {
		let attempts = 0;
		const result = withRetry(
			() => {
				attempts++;
				throw new HttpError(404, "/missing.png");
			},
			{ attempts: 3, baseMs: 1 },
		);

		await expect(result).rejects.toBeInstanceOf(HttpError);
		expect(attempts).toBe(1);
	});

	it("retries server errors with backoff", async () => {
		vi.spyOn(Math, "random").mockReturnValue(0);
		let attempts = 0;
		const result = await withRetry(
			(attempt) => {
				attempts = attempt;
				if (attempt < 3) throw new HttpError(503, "/flaky.json");
				return { ok: true };
			},
			{ attempts: 3, baseMs: 1 },
		);

		expect(result).toEqual({ ok: true });
		expect(attempts).toBe(3);
		vi.restoreAllMocks();
	});

	it("stops waiting when the signal aborts", async () => {
		const controller = new AbortController();
		setTimeout(() => controller.abort(), 10);
		const result = withRetry(
			() => {
				throw new HttpError(503, "/slow.json");
			},
			{ attempts: 3, baseMs: 1000, signal: controller.signal },
		);

		await expect(result).rejects.toMatchObject({ name: "AbortError" });
	});
});

describe("loadAll", () => {
	it("reports progress and keeps optional failures", async () => {
		const seen: Array<{ done: number; total: number; name: string }> = [];
		const result = await loadAll(
			{},
			{
				extra: [
					{
						name: "required",
						group: "extras",
						required: true,
						load: () => Promise.resolve("ok"),
					},
					{
						name: "optional",
						group: "sounds",
						required: false,
						fallback: "silence",
						load: () => Promise.reject(new Error("decode failed")),
					},
				],
				onProgress: (progress) => {
					seen.push({
						done: progress.done,
						total: progress.total,
						name: progress.name,
					});
				},
			},
		);

		expect(result.extras.required).toBe("ok");
		expect(result.sounds.optional).toBe("silence");
		expect(result.failures).toHaveLength(1);
		expect(seen).toHaveLength(2);
		expect(seen.at(-1)).toMatchObject({ done: 2, total: 2 });
	});

	it("propagates required failures", async () => {
		const result = loadAll(
			{},
			{
				extra: [
					{
						name: "sprites",
						group: "sprites",
						required: true,
						load: () => Promise.reject(new Error("404")),
					},
				],
			},
		);

		await expect(result).rejects.toThrow("404");
	});
});
