const STATE_KEY = Symbol.for("pi.tool-display.state");

type ToolDisplayState = {
	callsExpanded: boolean;
	outputWrapped: boolean;
};

function state(): ToolDisplayState {
	const host = globalThis as typeof globalThis & { [STATE_KEY]?: ToolDisplayState };
	return (host[STATE_KEY] ??= { callsExpanded: false, outputWrapped: true });
}

export const CALL_TOGGLE_HINT = "ctrl+shift+o";
export const WRAP_TOGGLE_HINT = "ctrl+shift+w";

export function areToolCallsExpanded(): boolean {
	return state().callsExpanded;
}

export function toggleToolCallsExpanded(): boolean {
	const shared = state();
	shared.callsExpanded = !shared.callsExpanded;
	return shared.callsExpanded;
}

/** Whether textual tool output may occupy continuation rows. Display-only. */
export function areToolOutputsWrapped(): boolean {
	return state().outputWrapped;
}

export function toggleToolOutputWrap(): boolean {
	const shared = state();
	shared.outputWrapped = !shared.outputWrapped;
	return shared.outputWrapped;
}

/** Reset session-local display state. */
export function resetToolDisplayState(): void {
	const shared = state();
	shared.callsExpanded = false;
	shared.outputWrapped = true;
}
