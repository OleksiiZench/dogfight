export class LatencyInjector {
	constructor({ latencyMs = 0, jitterMs = 0, dropRate = 0 } = {}) {
		this.latencyMs = latencyMs;
		this.jitterMs = jitterMs;
		this.dropRate = dropRate;
	}

	configure({
		latencyMs = this.latencyMs,
		jitterMs = this.jitterMs,
		dropRate = this.dropRate,
	} = {}) {
		this.latencyMs = Math.max(0, Math.min(2000, Number(latencyMs) || 0));
		this.jitterMs = Math.max(0, Math.min(2000, Number(jitterMs) || 0));
		this.dropRate = Math.max(0, Math.min(1, Number(dropRate) || 0));
	}

	get settings() {
		return {
			latencyMs: this.latencyMs,
			jitterMs: this.jitterMs,
			dropRate: this.dropRate,
		};
	}

	shouldDrop() {
		return Math.random() < this.dropRate;
	}

	delay() {
		const wait = this.latencyMs + Math.random() * this.jitterMs;
		if (wait <= 0) return Promise.resolve();
		return new Promise((resolve) => setTimeout(resolve, wait));
	}
}
