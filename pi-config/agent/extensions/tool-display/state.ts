import { truncateToWidth } from "@earendil-works/pi-tui";

const STATE_KEY = Symbol.for("pi.tool-display.state");

type ToolDisplayState = { resultsExpanded: boolean };

function state(): ToolDisplayState {
	const host = globalThis as typeof globalThis & { [STATE_KEY]?: ToolDisplayState };
	return (host[STATE_KEY] ??= { resultsExpanded: false });
}

export const RESULT_TOGGLE_HINT = "ctrl+shift+o";

export function areToolResultsExpanded(): boolean {
	return state().resultsExpanded;
}

export function toggleToolResultsExpanded(): boolean {
	const shared = state();
	shared.resultsExpanded = !shared.resultsExpanded;
	return shared.resultsExpanded;
}

export function resetToolResultsExpanded(): void {
	state().resultsExpanded = false;
}

/**
 * Existing tool rows retain the renderer module created when their call started.
 * Flip native expansion twice so every row rebuilds, while restoring the call
 * detail state that ctrl+o owns.
 */
export function refreshToolRows(ctx: { ui: { getToolsExpanded(): boolean; setToolsExpanded(expanded: boolean): void } }): void {
	const callsExpanded = ctx.ui.getToolsExpanded();
	ctx.ui.setToolsExpanded(!callsExpanded);
	ctx.ui.setToolsExpanded(callsExpanded);
}

export function previewResult(text: string, maxLines: number): { body: string; remaining: number } {
	const lines = text.split("\n");
	const shown = areToolResultsExpanded() ? lines : lines.slice(0, Math.max(1, maxLines));
	const width = Math.max(12, process.stdout.columns ?? 80);
	return {
		body: shown.map((line) => truncateToWidth(line, width, "…")).join("\n"),
		remaining: Math.max(0, lines.length - shown.length),
	};
}

export function resultToggleHint(): string {
	return `${RESULT_TOGGLE_HINT} to ${areToolResultsExpanded() ? "collapse" : "expand"} results`;
}
