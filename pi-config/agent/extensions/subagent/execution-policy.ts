import { checkRestrictedToolCall } from "../plan-mode/restricted-mode.ts";
import type { AccessMode } from "../plan-mode/plan-state.ts";

/** This policy narrows Pi tool calls; it is not a shell sandbox. */
export function accessModeFrom(value: unknown): AccessMode {
	return value === "plan" || value === "read-only" ? value : "none";
}

export function childToolRestriction(mode: AccessMode, name: string, input: Record<string, unknown>): string | undefined {
	return checkRestrictedToolCall(mode, name, input);
}
