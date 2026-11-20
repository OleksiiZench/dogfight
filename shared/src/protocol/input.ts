import type { InputFields, Intent, Result, Snapshot } from "../types.ts";
import { asSeq, asTick } from "../types.ts";
import { CLOSE, ClientInputSchema, SnapshotMessageSchema } from "./schema.ts";

export const EMPTY_INTENT: Readonly<Intent> = Object.freeze({
	turn: 0,
	thrust: false,
	fire: false,
});

export function intentOf(input: InputFields | null | undefined): Intent {
	if (!input) return { ...EMPTY_INTENT };
	return {
		seq: input.seq === undefined ? undefined : asSeq(input.seq),
		turn: input.turn,
		thrust: Boolean(input.thrust),
		fire: Boolean(input.fire),
	};
}

export interface InputState {
	[key: string]: InputFields;
}

export const DEFAULT_INPUT: InputFields = {
	seq: asSeq(0),
	tick: asTick(0),
	turn: 0,
	thrust: false,
	fire: false,
};

export function readInput(
	source: Partial<InputFields> | null | undefined,
	seq: number,
	tick: number,
): InputFields {
	return {
		seq: asSeq(Number(source?.seq ?? seq)),
		tick: asTick(Number(source?.tick ?? tick)),
		turn: clamp(Number(source?.turn ?? 0), -1, 1),
		thrust: Boolean(source?.thrust),
		fire: Boolean(source?.fire),
	};
}

function clamp(value: number, min: number, max: number): number {
	return Math.min(max, Math.max(min, Number.isFinite(value) ? value : 0));
}

export function updateInput(
	state: InputState,
	key: string,
	message: InputFields,
): boolean {
	const previous = state[key] ?? DEFAULT_INPUT;
	if (message.seq <= previous.seq) return false;
	state[key] = readInput(message, message.seq, message.tick);
	return true;
}

function failure<T>(message: string): Result<T> {
	return {
		ok: false,
		error: { code: CLOSE.INVALID_MESSAGE, message },
	};
}

export function validateInput(source: unknown): Result<InputFields> {
	const result = ClientInputSchema.safeParse(source);
	if (!result.success) {
		return failure(result.error.issues[0]?.message ?? "invalid input message");
	}
	return { ok: true, value: result.data };
}

export function validateSnapshot(source: unknown): Result<Snapshot> {
	const result = SnapshotMessageSchema.safeParse(source);
	if (!result.success) {
		return failure(result.error.issues[0]?.message ?? "invalid snapshot");
	}
	return { ok: true, value: result.data };
}
