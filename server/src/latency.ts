import type { NetSettings } from "shared/protocol/schema.ts";

export class LatencyInjector {
	latencyMs: number;
	jitterMs: number;
	dropRate: number;

	constructor({
		latencyMs = 0,
		jitterMs = 0,
		dropRate = 0,
	}: Partial<NetSettings> = {}) {
		this.latencyMs = latencyMs;
		this.jitterMs = jitterMs;
		this.dropRate = dropRate;
	}

	configure({
		latencyMs = this.latencyMs,
		jitterMs = this.jitterMs,
		dropRate = this.dropRate,
	}: Partial<NetSettings> = {}): void {
		this.latencyMs = Math.max(0, Math.min(2000, Number(latencyMs) || 0));
		this.jitterMs = Math.max(0, Math.min(2000, Number(jitterMs) || 0));
		this.dropRate = Math.max(0, Math.min(1, Number(dropRate) || 0));
	}

	get settings(): NetSettings {
		return {
			latencyMs: this.latencyMs,
			jitterMs: this.jitterMs,
			dropRate: this.dropRate,
		};
	}

	shouldDrop(): boolean {
		return Math.random() < this.dropRate;
	}

	delay(): Promise<void> {
		const wait = this.latencyMs + Math.random() * this.jitterMs;
		if (wait <= 0) return Promise.resolve();
		return new Promise<void>((resolve) => setTimeout(resolve, wait));
	}
}
