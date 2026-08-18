/** Apply user-disabled deltas without widening a plan-owned positive allowlist. */
export function resolveToolSelection(all: string[], current: string[], disabled: Iterable<string>, planOwnsTools: boolean): string[] {
	const disabledSet = new Set(disabled);
	return (planOwnsTools ? current : all).filter((name) => !disabledSet.has(name));
}
