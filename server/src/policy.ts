export interface RateLimitState {
	tokens: number;
	lastRefill: number;
}

export interface RateLimiter {
	initial(now: number): RateLimitState;
	allow(state: RateLimitState, now: number): boolean;
}

export function createRateLimiter(perSecond: number): RateLimiter {
	return {
		initial(now) {
			return { tokens: perSecond, lastRefill: now };
		},
		allow(state, now) {
			const elapsed = now - state.lastRefill;
			state.tokens = Math.min(
				perSecond,
				state.tokens + (elapsed * perSecond) / 1000,
			);
			state.lastRefill = now;
			if (state.tokens < 1) return false;
			state.tokens -= 1;
			return true;
		},
	};
}

export interface HeartbeatState {
	missedPongs: number;
	isAlive: boolean;
}

export type HeartbeatAction = "skip" | "ping" | "terminate";

export interface HeartbeatResult extends HeartbeatState {
	action: HeartbeatAction;
}

export function heartbeat(
	state: HeartbeatState,
	maxMissedPongs: number,
): HeartbeatResult {
	if (!state.isAlive) {
		const missedPongs = state.missedPongs + 1;
		if (missedPongs >= maxMissedPongs)
			return { action: "terminate", missedPongs, isAlive: false };
		return { action: "ping", missedPongs, isAlive: false };
	}
	return { action: "ping", missedPongs: 0, isAlive: false };
}
