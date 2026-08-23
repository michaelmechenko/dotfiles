import type { AccessMode } from "./plan-state.ts";

/** Direct file mutations stay unavailable while planning or inspecting. Bash remains intentionally available. */
export const RESTRICTED_MUTATION_TOOLS = new Set(["write", "edit", "apply_patch"]);
export const PLAN_UPDATE_TOOL = "plan_update";
export const PLAN_EXECUTION_TOOLS = ["plan_step", PLAN_UPDATE_TOOL, "plan_complete"];

/** Preserve the caller's active-tool baseline instead of maintaining a stale inspection allowlist. */
export function restrictedTools(accessMode: AccessMode, baseline: Iterable<string>, availableTools: Iterable<string>): string[] {
	const available = new Set(availableTools);
	const names = [...baseline].filter((name) => !RESTRICTED_MUTATION_TOOLS.has(name) && !PLAN_EXECUTION_TOOLS.includes(name));
	if (accessMode === "plan") names.push(PLAN_UPDATE_TOOL);
	return [...new Set(names)].filter((name) => available.has(name));
}

export function restrictionGuidance(accessMode: AccessMode): string | undefined {
	if (accessMode === "plan") return "[PLAN MODE: DIRECT FILE MUTATIONS DISABLED]\nInspect and investigate freely, including with bash. Do not use write, edit, or apply_patch. Ask a focused clarification when needed. When ready, call plan_update with the goal, top-level steps, verification criteria, follow-up work, and a complete execution brief. Do not treat free-text planning as authoritative.";
	if (accessMode === "read-only") return "[READ-ONLY MODE: DIRECT FILE MUTATIONS DISABLED]\nInspect and investigate freely, including with bash. Do not use write, edit, or apply_patch, create a structured plan, or call plan tools. Explain findings and request a mode change before making direct file changes.";
	return undefined;
}

/** Defense in depth for extensions or stale active-tool state that invoke a blocked direct mutation. */
export function checkRestrictedToolCall(accessMode: AccessMode, toolName: string): string | undefined {
	if (accessMode !== "none" && RESTRICTED_MUTATION_TOOLS.has(toolName)) return `${accessMode} mode blocks direct file mutation tool '${toolName}'.`;
	if (accessMode === "read-only" && PLAN_EXECUTION_TOOLS.includes(toolName)) return "read-only mode blocks plan tools.";
	if (accessMode === "plan" && (toolName === "plan_step" || toolName === "plan_complete")) return "plan mode blocks execution-only plan tools.";
	return undefined;
}
