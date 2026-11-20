import type { Loop } from "./src/loop.ts";
import type { Connection } from "./src/net/connection.ts";
import type { MatchView } from "./src/net/match.ts";
import type { Predictor } from "./src/net/predictor.ts";

declare global {
	interface Window {
		__dogfight?: {
			connection: Connection;
			matchView: MatchView;
			predictor: Predictor;
			loop: Loop;
		};
	}
}
