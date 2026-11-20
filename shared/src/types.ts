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
	readonly name: string;
	readonly remaining: number | null;
}

export interface ParticleSnapshot {
	readonly x: number;
	readonly y: number;
	readonly vx: number;
	readonly vy: number;
	readonly ttl: number;
}

interface EntityDataBase {
	readonly id: number;
	readonly kind: EntityKind;
	readonly x: number;
	readonly y: number;
	readonly vx: number;
	readonly vy: number;
	readonly angle: number;
	readonly age: number;
	readonly radius: number;
	readonly behaviors: readonly BehaviorSnapshot[];
}

export type EntityData =
	| (EntityDataBase & {
			readonly kind: "ship";
			readonly playerId: PlayerId;
			readonly color: string;
			readonly hp: number;
			readonly maxHp: number;
			readonly fireDelay: number;
			readonly cooldown: number;
			readonly thrusting: boolean;
	  })
	| (EntityDataBase & {
			readonly kind: "bullet";
			readonly ownerId: PlayerId;
			readonly sourceSeq: number | null;
			readonly ttl: number;
			readonly damage: number;
	  })
	| (EntityDataBase & {
			readonly kind: "asteroid";
			readonly hp: number;
			readonly spin: number;
			readonly shape: readonly number[];
	  })
	| (EntityDataBase & {
			readonly kind: "pickup";
			readonly effect: EffectName;
			readonly ttl: number;
	  })
	| (EntityDataBase & {
			readonly kind: "explosion";
			readonly color: string;
			readonly life: number;
			readonly particles: readonly ParticleSnapshot[];
	  });

export interface PlayerSnapshot {
	readonly id: PlayerId;
	readonly name: string;
	readonly color: string;
	readonly score: number;
	readonly shipId: number | null;
	readonly respawnIn: number | null;
}

export interface Snapshot {
	readonly type: "snapshot";
	readonly tick: number;
	readonly arena: Arena;
	readonly entities: readonly EntityData[];
	readonly players: readonly PlayerSnapshot[];
	readonly events?: readonly GameEvent[];
	readonly lastProcessedSeq?: number;
}

export interface DecodedSnapshot extends Snapshot {
	readonly events: readonly GameEvent[];
	readonly lastProcessedSeq: number;
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

export type ReadonlyDeep<T> = T extends
	| number
	| string
	| boolean
	| bigint
	| symbol
	| null
	| undefined
	? T
	: T extends readonly (infer Item)[]
		? readonly ReadonlyDeep<Item>[]
		: T extends object
			? { readonly [Key in keyof T]: ReadonlyDeep<T[Key]> }
			: T;

export function assertNever(value: never): never {
	throw new Error(`unhandled variant: ${JSON.stringify(value)}`);
}
