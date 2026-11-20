export function requireElement<T extends Element>(
	root: ParentNode,
	selector: string,
): T {
	const element = root.querySelector<T>(selector);
	if (!element) throw new Error(`missing element: ${selector}`);
	return element;
}

export function errorMessage(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}
