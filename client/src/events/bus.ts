export function createBus(): EventTarget {
	return new EventTarget();
}

export function dispatch(
	bus: EventTarget | null | undefined,
	type: string,
	detail: unknown = undefined,
): void {
	bus?.dispatchEvent(new CustomEvent(type, { detail }));
}

export function detailOf<T>(event: Event): T {
	// Localized assertion: dispatch() always emits CustomEvent with our detail.
	return (event as CustomEvent<T>).detail;
}
