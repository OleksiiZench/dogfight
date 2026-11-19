export function createBus() {
	return new EventTarget();
}

export function dispatch(bus, type, detail) {
	bus?.dispatchEvent(new CustomEvent(type, { detail }));
}
