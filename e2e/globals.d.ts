interface DebugPoint {
	readonly x: number;
	readonly y: number;
}

interface DebugGame {
	readonly connection: {
		readonly socket: { close(code?: number, reason?: string): void } | null;
		dispatchEvent(event: Event): boolean;
	};
	readonly predictor: {
		readonly visualPos: DebugPoint | null;
	};
	readonly matchView: {
		readonly lastEntityData: ReadonlyMap<
			number,
			{
				readonly kind: string;
				readonly x: number;
				readonly y: number;
			}
		>;
	};
	readonly loop: {
		readonly stats: {
			readonly framesPerSecond: number;
			readonly frameTime: number;
			readonly frameTimes: readonly number[];
			readonly workTimes: readonly number[];
		};
	};
	readonly profile: {
		readonly measures: () => ReadonlyArray<{
			readonly name: string;
			readonly duration: number;
		}>;
		readonly clear: () => void;
	};
}

declare global {
	interface Window {
		readonly __dogfight?: DebugGame;
	}
}

export {};
