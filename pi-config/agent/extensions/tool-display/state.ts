import { truncateToWidth } from "@earendil-works/pi-tui";

const STATE_KEY = Symbol.for("pi.tool-display.state");

type ToolDisplayState = { callsExpanded: boolean };

function state(): ToolDisplayState {
	const host = globalThis as typeof globalThis & { [STATE_KEY]?: ToolDisplayState };
	return (host[STATE_KEY] ??= { callsExpanded: false });
}

export const CALL_TOGGLE_HINT = "ctrl+shift+o";

export function areToolCallsExpanded(): boolean {
	return state().callsExpanded;
}

export function toggleToolCallsExpanded(): boolean {
	const shared = state();
	shared.callsExpanded = !shared.callsExpanded;
	return shared.callsExpanded;
}

export function resetToolCallsExpanded(): void {
	state().callsExpanded = false;
}

export function previewResult(text: string, maxLines: number, expanded: boolean): { body: string; remaining: number } {
	const lines = text.split("\n");
	const shown = expanded ? lines : lines.slice(0, Math.max(1, maxLines));
	const width = Math.max(12, process.stdout.columns ?? 80);
	return {
		body: shown.map((line) => truncateToWidth(line, width, "…")).join("\n"),
		remaining: Math.max(0, lines.length - shown.length),
	};
}
