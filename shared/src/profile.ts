export interface ProfileMeasure {
	name: string;
	startTime: number;
	duration: number;
}

interface MeasureEntry {
	name: string;
	startTime: number;
	duration: number;
}

const PREFIX = "dogfight:";
let enabled = false;
let counter = 0;

export function setProfileEnabled(value: boolean): void {
	enabled = value;
}

export function isProfileEnabled(): boolean {
	return enabled;
}

export function beginProfile(name: string): string | null {
	if (!enabled) return null;
	counter += 1;
	const token = `${PREFIX}${name}:${counter}`;
	performance.mark(`${token}:start`);
	return token;
}

export function endProfile(token: string | null, name: string): void {
	if (!enabled || token === null) return;
	performance.mark(`${token}:end`);
	performance.measure(`${PREFIX}${name}`, `${token}:start`, `${token}:end`);
	performance.clearMarks(`${token}:start`);
	performance.clearMarks(`${token}:end`);
}

export function measureProfile<T>(name: string, run: () => T): T {
	const token = beginProfile(name);
	try {
		return run();
	} finally {
		endProfile(token, name);
	}
}

export function profileMeasures(limit = 4000): ProfileMeasure[] {
	const entries = performance.getEntriesByType(
		"measure",
	) as unknown as MeasureEntry[];
	return entries
		.filter((entry) => entry.name.startsWith(PREFIX))
		.slice(-limit)
		.map((entry) => ({
			name: entry.name.slice(PREFIX.length),
			startTime: entry.startTime,
			duration: entry.duration,
		}));
}

export function clearProfileMeasures(): void {
	performance.clearMeasures();
	for (const entry of performance.getEntriesByType("mark")) {
		if (entry.name.startsWith(PREFIX)) performance.clearMarks(entry.name);
	}
}
