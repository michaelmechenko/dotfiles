export type ContextTone = "dim" | "warning" | "error";

export function contextTone(percent: number): ContextTone {
	return percent >= 90 ? "error" : percent >= 70 ? "warning" : "dim";
}

export function compactionLabel(enabled: boolean, compacting: boolean): string {
	return compacting ? " (compacting)" : enabled ? " (auto)" : " (manual)";
}
