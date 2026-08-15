import type { AccessMode } from "./plan-state.ts";
import { isSafeCommand } from "./utils.ts";

export const SHARED_READ_ONLY_TOOLS = new Set([
	"read", "bash", "grep", "find", "ls", "webfetch", "websearch", "lsp", "ast_grep",
	"session_search", "session_query", "ask_user",
]);
export const PLAN_UPDATE_TOOL = "plan_update";
export const PLAN_EXECUTION_TOOLS = ["plan_step", PLAN_UPDATE_TOOL, "plan_complete"];

export function restrictedTools(accessMode: AccessMode, availableTools: Iterable<string>): string[] {
	const available = new Set(availableTools);
	const names = accessMode === "plan" ? [...SHARED_READ_ONLY_TOOLS, PLAN_UPDATE_TOOL] : accessMode === "read-only" ? [...SHARED_READ_ONLY_TOOLS] : [];
	return names.filter((name) => available.has(name));
}

export function restrictionGuidance(accessMode: AccessMode): string | undefined {
	if (accessMode === "plan") {
		return "[PLAN MODE: READ ONLY]\nInspect only. Use only the active read-only tools. Ask a focused clarification when needed. When ready, call plan_update with the goal, top-level steps, verification criteria, and follow-up work. Do not edit files or treat free-text planning as authoritative.";
	}
	if (accessMode === "read-only") {
		return "[READ-ONLY MODE]\nInspect only. Use only the active read-only tools. Do not edit files, create a structured plan, or call plan tools. Explain findings and request a mode change before making changes.";
	}
	return undefined;
}

export function checkRestrictedToolCall(accessMode: AccessMode, toolName: string, input: unknown): string | undefined {
	if (accessMode === "none") return undefined;
	const allowed = accessMode === "plan" ? new Set([...SHARED_READ_ONLY_TOOLS, PLAN_UPDATE_TOOL]) : SHARED_READ_ONLY_TOOLS;
	if (!allowed.has(toolName)) return `${accessMode} mode blocks '${toolName}'; only the positive read-only allowlist is available.`;
	if (toolName === "bash") {
		const command = typeof (input as { command?: unknown })?.command === "string" ? (input as { command: string }).command : "";
		if (!isSafeCommand(command)) return `${accessMode} mode allows only read-only bash commands.`;
	}
	return undefined;
}

export function checkRestrictedUserBash(accessMode: AccessMode, command: string): string | undefined {
	if (accessMode === "none" || isSafeCommand(command)) return undefined;
	return `${accessMode} mode allows only read-only bash commands.`;
}
