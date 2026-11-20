import type { ProfileMeasure } from "shared/profile.ts";
import type { Loop } from "./src/loop.ts";
import type { Connection } from "./src/net/connection.ts";
import type { MatchView } from "./src/net/match.ts";
import type { Predictor } from "./src/net/predictor.ts";

declare global {
	const __APP_VERSION__: string;

	interface Window {
		__dogfight?: {
			connection: Connection;
			matchView: MatchView;
			predictor: Predictor;
			loop: Loop;
			profile: {
				measures: (limit?: number) => ProfileMeasure[];
				clear: () => void;
			};
		};
	}
}
