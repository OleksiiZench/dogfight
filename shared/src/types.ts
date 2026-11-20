declare const brand: unique symbol;

type Brand<T, B extends string> = T & { readonly [brand]: B };

export type EntityId = Brand<number, "EntityId">;
export type Tick = Brand<number, "Tick">;
export type Seq = Brand<number, "Seq">;
export type PlayerId = string;

const branded = <B extends string>(value: number): Brand<number, B> =>
	// Single zero-cost assertion for all brands: they are plain numbers at runtime.
	value as Brand<number, B>;

export const asEntityId = (value: number): EntityId =>
	branded<"EntityId">(value);
export const asTick = (value: number): Tick => branded<"Tick">(value);
export const asSeq = (value: number): Seq => branded<"Seq">(value);

export interface Arena {
	readonly width: number;
	readonly height: number;
}

export interface Point {
	readonly x: number;
	readonly y: number;
}

export type EntityKind =
	| "ship"
	| "bullet"
	| "asteroid"
	| "pickup"
	| "explosion";

export type EffectName = "shield" | "rapid" | "homing" | "repair";

export interface BehaviorSnapshot {
	name: string;
	remaining: number | null;
}

export interface ParticleSnapshot {
	x: number;
	y: number;
	vx: number;
	vy: number;
	ttl: number;
}

interface EntityDataBase {
	id: number;
	kind: EntityKind;
	x: number;
	y: number;
	vx: number;
	vy: number;
	angle: number;
	age: number;
	radius: number;
	behaviors: BehaviorSnapshot[];
}

export type EntityData =
	| (EntityDataBase & {
			kind: "ship";
			playerId: PlayerId;
			color: string;
			hp: number;
			maxHp: number;
			fireDelay: number;
			cooldown: number;
			thrusting: boolean;
	  })
	| (EntityDataBase & {
			kind: "bullet";
			ownerId: PlayerId;
			sourceSeq: number | null;
			ttl: number;
			damage: number;
	  })
	| (EntityDataBase & {
			kind: "asteroid";
			hp: number;
			spin: number;
			shape: number[];
	  })
	| (EntityDataBase & {
			kind: "pickup";
			effect: EffectName;
			ttl: number;
	  })
	| (EntityDataBase & {
			kind: "explosion";
			color: string;
			life: number;
			particles: ParticleSnapshot[];
	  });

export interface PlayerSnapshot {
	id: PlayerId;
	name: string;
	color: string;
	score: number;
	shipId: number | null;
	respawnIn: number | null;
}

export interface Snapshot {
	type: "snapshot";
	tick: number;
	arena: Arena;
	entities: EntityData[];
	players: PlayerSnapshot[];
	events?: GameEvent[];
	lastProcessedSeq?: number;
}

export interface DecodedSnapshot extends Snapshot {
	events: GameEvent[];
	lastProcessedSeq: number;
}

export interface ShipSummary {
	id: EntityId;
	playerId: PlayerId;
	color: string;
}

export type GameEvent =
	| { type: "fired"; ownerId: PlayerId; pos: Point; angle: number }
	| { type: "hit"; target: "ship" | "asteroid"; pos: Point }
	| { type: "exploded"; pos: Point; color: string }
	| { type: "shipDestroyed"; ship: ShipSummary; killerId: PlayerId | null }
	| { type: "asteroidDestroyed"; killerId: PlayerId | null }
	| { type: "pickup"; effect: EffectName; pos: Point }
	| { type: "scoreChanged"; scores: Record<PlayerId, number> };

export interface Rng {
	next(): number;
	range(min: number, max: number): number;
	pick<T>(items: readonly T[]): T | undefined;
}

export interface Intent {
	turn: number;
	thrust: boolean;
	fire: boolean;
	seq?: Seq;
}

export interface InputFields {
	seq: number;
	tick: number;
	turn: number;
	thrust?: boolean;
	fire?: boolean;
}

export interface InputMessage extends InputFields {
	type: "input";
	seq: Seq;
	tick: Tick;
	thrust: boolean;
	fire: boolean;
}

export type CodecName = "json" | "binary";
export type WirePayload = string | ArrayBuffer;
export type BinarySource = ArrayBuffer | ArrayBufferView;

export interface ProtocolFailure {
	code: number;
	message: string;
}

export type Result<T, E = ProtocolFailure> =
	| { ok: true; value: T }
	| { ok: false; error: E };

export function assertNever(value: never): never {
	throw new Error(`unhandled variant: ${JSON.stringify(value)}`);
}
