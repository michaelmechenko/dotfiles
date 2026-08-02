/**
 * Plan Mode Extension
 *
 * Read-only exploration mode for safe code analysis.
 * When enabled, built-in write tools are disabled.
 *
 * Features:
 * - /plan command or Ctrl+Alt+P to toggle
 * - Bash restricted to allowlisted read-only commands
 * - Extracts numbered plan steps from "Plan:" sections
 * - plan_step tool for the agent to mark steps complete/skipped during execution
 * - Progress widget during execution, collapsible via /plan-widget or Ctrl+Alt+T
 * - /todos opens an interactive view to manually toggle any step's status
 * - /plan-edit lets you add/remove/reword steps mid-execution
 */

import type { AgentMessage } from "@earendil-works/pi-agent-core";
import type { AssistantMessage, TextContent } from "@earendil-works/pi-ai";
import { StringEnum } from "@earendil-works/pi-ai";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { Key, matchesKey, Text as UiText, truncateToWidth } from "@earendil-works/pi-tui";
import { Type } from "typebox";
import {
	extractTodoItems,
	isSafeCommand,
	mergePlanSteps,
	parsePlanEditText,
	type TodoItem,
} from "./utils.ts";

// Tools
const PLAN_MODE_TOOLS = ["read", "bash", "grep", "find", "ls", "questionnaire"];
const NORMAL_MODE_TOOLS = ["read", "bash", "edit", "write"];
const PLAN_MODE_DISABLED_TOOLS = new Set<string>(["edit", "write"]);
const PLAN_MANAGED_TOOLS = new Set<string>([...PLAN_MODE_TOOLS, ...NORMAL_MODE_TOOLS]);
const PLAN_STEP_TOOL = "plan_step";

interface PlanModeState {
	enabled: boolean;
	todos?: TodoItem[];
	executing?: boolean;
	toolsBeforePlanMode?: string[];
	widgetCollapsed?: boolean;
}

const PlanStepParams = Type.Object({
	action: StringEnum(["complete", "uncomplete", "skip", "list"] as const),
	step: Type.Optional(
		Type.Number({ description: "Step number (1-indexed). Required for complete/uncomplete/skip." }),
	),
});

// Type guard for assistant messages
function isAssistantMessage(m: AgentMessage): m is AssistantMessage {
	return m.role === "assistant" && Array.isArray(m.content);
}

// Extract text content from an assistant message
function getTextContent(message: AssistantMessage): string {
	return message.content
		.filter((block): block is TextContent => block.type === "text")
		.map((block) => block.text)
		.join("\n");
}

// Whether an assistant message made any tool calls. A message with none is a
// genuine stopping point (the model finished responding), not a mid-tool-cycle
// pause - used to detect "model believes it's done" even without plan_step calls.
function hasToolCalls(message: AssistantMessage): boolean {
	return message.content.some((block) => block.type === "toolCall");
}

function isStepDone(item: TodoItem): boolean {
	return item.completed || item.skipped;
}

function stepStatusChar(item: TodoItem): string {
	if (item.completed) return "x";
	if (item.skipped) return "-";
	return " ";
}

export default function planModeExtension(pi: ExtensionAPI): void {
	let planModeEnabled = false;
	let executionMode = false;
	let todoItems: TodoItem[] = [];
	let toolsBeforePlanMode: string[] | undefined;
	let widgetCollapsed = false;

	pi.registerFlag("plan", {
		description: "Start in plan mode (read-only exploration)",
		type: "boolean",
		default: false,
	});

	function updateStatus(ctx: ExtensionContext): void {
		// Footer status
		if (executionMode && todoItems.length > 0) {
			const done = todoItems.filter(isStepDone).length;
			ctx.ui.setStatus("plan-mode", ctx.ui.theme.fg("accent", `plan ${done}/${todoItems.length}`));
		} else if (planModeEnabled) {
			ctx.ui.setStatus("plan-mode", ctx.ui.theme.fg("warning", "plan (paused)"));
		} else {
			ctx.ui.setStatus("plan-mode", undefined);
		}

		// Widget showing todo list
		if (!executionMode || todoItems.length === 0) {
			ctx.ui.setWidget("plan-todos", undefined);
			return;
		}

		const th = ctx.ui.theme;
		if (widgetCollapsed) {
			const done = todoItems.filter(isStepDone).length;
			const next = todoItems.find((t) => !isStepDone(t));
			const progress = th.fg("accent", `plan ${done}/${todoItems.length}`);
			const line = next ? `${progress} ${th.fg("muted", "—")} ${next.text}` : `${progress} ${th.fg("muted", "(finishing up)")}`;
			ctx.ui.setWidget("plan-todos", [line]);
			return;
		}

		const lines = todoItems.map((item) => {
			if (item.completed) {
				return th.fg("success", "[x] ") + th.fg("muted", th.strikethrough(item.text));
			}
			if (item.skipped) {
				return th.fg("dim", "[-] ") + th.fg("dim", th.strikethrough(item.text));
			}
			return `${th.fg("muted", "[ ] ")}${item.text}`;
		});
		ctx.ui.setWidget("plan-todos", lines);
	}

	function uniqueToolNames(toolNames: string[]): string[] {
		return [...new Set(toolNames)];
	}

	function getPlanModeTools(activeToolNames: string[]): string[] {
		return uniqueToolNames([
			...activeToolNames.filter((name) => !PLAN_MODE_DISABLED_TOOLS.has(name)),
			...PLAN_MODE_TOOLS,
		]);
	}

	function getNormalModeTools(activeToolNames: string[]): string[] {
		return uniqueToolNames([
			...NORMAL_MODE_TOOLS,
			...activeToolNames.filter((name) => !PLAN_MANAGED_TOOLS.has(name)),
		]);
	}

	function enablePlanModeTools(): void {
		if (toolsBeforePlanMode === undefined) {
			toolsBeforePlanMode = pi.getActiveTools();
		}
		pi.setActiveTools(getPlanModeTools(toolsBeforePlanMode));
	}

	function restoreNormalModeTools(): void {
		pi.setActiveTools(toolsBeforePlanMode ?? getNormalModeTools(pi.getActiveTools()));
		toolsBeforePlanMode = undefined;
	}

	function enableExecutionTools(): void {
		restoreNormalModeTools();
		pi.setActiveTools(uniqueToolNames([...pi.getActiveTools(), PLAN_STEP_TOOL]));
	}

	function disableExecutionTools(): void {
		pi.setActiveTools(pi.getActiveTools().filter((name) => name !== PLAN_STEP_TOOL));
	}

	function persistState(): void {
		pi.appendEntry("plan-mode", {
			enabled: planModeEnabled,
			todos: todoItems,
			executing: executionMode,
			toolsBeforePlanMode,
			widgetCollapsed,
		});
	}

	function togglePlanMode(ctx: ExtensionContext): void {
		planModeEnabled = !planModeEnabled;
		executionMode = false;
		todoItems = [];

		if (planModeEnabled) {
			enablePlanModeTools();
			ctx.ui.notify("Plan mode enabled. Built-in write tools disabled.");
		} else {
			disableExecutionTools();
			restoreNormalModeTools();
			ctx.ui.notify("Plan mode disabled. Full access restored.");
		}
		updateStatus(ctx);
		persistState();
	}

	function toggleWidgetCollapsed(ctx: ExtensionContext): void {
		widgetCollapsed = !widgetCollapsed;
		updateStatus(ctx);
		persistState();
	}

	function endExecution(ctx: ExtensionContext): void {
		executionMode = false;
		todoItems = [];
		disableExecutionTools();
		updateStatus(ctx);
		persistState();
	}

	pi.registerCommand("plan", {
		description: "Toggle plan mode (read-only exploration)",
		handler: async (_args, ctx) => togglePlanMode(ctx),
	});

	pi.registerCommand("plan-widget", {
		description: "Toggle collapsed/expanded plan progress widget",
		handler: async (_args, ctx) => {
			toggleWidgetCollapsed(ctx);
			ctx.ui.notify(widgetCollapsed ? "Plan widget collapsed." : "Plan widget expanded.", "info");
		},
	});

	pi.registerCommand("plan-edit", {
		description: "Edit the current plan's steps (add/remove/reorder/reword)",
		handler: async (_args, ctx) => {
			if (todoItems.length === 0) {
				ctx.ui.notify("No active plan to edit. Create one first with /plan.", "info");
				return;
			}
			if (!ctx.hasUI) {
				ctx.ui.notify("/plan-edit requires interactive mode", "error");
				return;
			}

			const currentText = todoItems.map((t) => `${t.step}. ${t.text}`).join("\n");
			const edited = await ctx.ui.editor("Edit plan steps (one per line):", currentText);
			if (edited === undefined || edited === null) return; // cancelled

			const newTexts = parsePlanEditText(edited);
			if (newTexts.length === 0) {
				ctx.ui.notify("No steps found in edited text - plan unchanged.", "warning");
				return;
			}

			todoItems = mergePlanSteps(todoItems, newTexts);
			updateStatus(ctx);
			persistState();
			ctx.ui.notify(`Plan updated: ${todoItems.length} step(s).`, "info");
		},
	});

	async function showTodoEditor(ctx: ExtensionContext): Promise<void> {
		if (todoItems.length === 0) {
			ctx.ui.notify("No todos. Create a plan first with /plan", "info");
			return;
		}
		if (!ctx.hasUI) {
			const list = todoItems.map((item, i) => `${i + 1}. [${stepStatusChar(item)}] ${item.text}`).join("\n");
			ctx.ui.notify(`Plan Progress:\n${list}`, "info");
			return;
		}

		await ctx.ui.custom<void>((tui, theme, _kb, done) => {
				let index = 0;
				let cachedLines: string[] | undefined;

				function refresh(): void {
					cachedLines = undefined;
					tui.requestRender();
				}

				// Cycles pending -> completed -> skipped -> pending
				function cycleStatus(item: TodoItem): void {
					if (!item.completed && !item.skipped) {
						item.completed = true;
					} else if (item.completed) {
						item.completed = false;
						item.skipped = true;
					} else {
						item.skipped = false;
					}
					updateStatus(ctx);
					persistState();
				}

				function handleInput(data: string): void {
					if (matchesKey(data, Key.escape) || matchesKey(data, "ctrl+c")) {
						done();
						return;
					}
					if (matchesKey(data, Key.up)) {
						index = (index - 1 + todoItems.length) % todoItems.length;
						refresh();
						return;
					}
					if (matchesKey(data, Key.down)) {
						index = (index + 1) % todoItems.length;
						refresh();
						return;
					}
					if (matchesKey(data, Key.space) || matchesKey(data, Key.enter)) {
						cycleStatus(todoItems[index]);
						refresh();
						return;
					}
				}

				function render(width: number): string[] {
					if (cachedLines) return cachedLines;
					const lines: string[] = [];
					const add = (s: string) => lines.push(truncateToWidth(s, width));

					const title = " Plan Progress ";
					add(theme.fg("accent", `─${title}${"─".repeat(Math.max(0, width - title.length - 1))}`));
					const done = todoItems.filter(isStepDone).length;
					add(` ${theme.fg("muted", `${done}/${todoItems.length} done`)}`);
					lines.push("");

					todoItems.forEach((item, i) => {
						const selected = i === index;
						const mark = item.completed
							? theme.fg("success", "[x] ")
							: item.skipped
								? theme.fg("dim", "[-] ")
								: theme.fg("muted", "[ ] ");
						const label = item.completed || item.skipped ? theme.fg("dim", item.text) : theme.fg("text", item.text);
						const prefix = selected ? theme.fg("accent", " ❯ ") : "   ";
						add(prefix + mark + label);
					});

					lines.push("");
					add(theme.fg("dim", " ↑↓ navigate • space/enter cycle pending/done/skipped • esc close"));
					add(theme.fg("accent", "─".repeat(width)));

					cachedLines = lines;
					return lines;
				}

				return {
					render,
					invalidate: () => {
						cachedLines = undefined;
					},
					handleInput,
				};
			});
	}

	pi.registerCommand("todos", {
		description: "View and manually adjust the current plan's progress",
		handler: async (_args, ctx) => showTodoEditor(ctx),
	});

	pi.registerShortcut(Key.ctrlAlt("p"), {
		description: "Toggle plan mode",
		handler: async (ctx) => togglePlanMode(ctx),
	});

	pi.registerShortcut(Key.ctrlAlt("t"), {
		description: "Toggle collapsed/expanded plan progress widget",
		handler: async (ctx) => toggleWidgetCollapsed(ctx),
	});

	// Tool the agent calls to track plan execution progress. Structured tool
	// calls are schema-enforced and show up as discrete transcript entries,
	// unlike free-text "[DONE:n]" tags the model could forget or paraphrase.
	pi.registerTool({
		name: PLAN_STEP_TOOL,
		label: "Plan Step",
		description:
			"Track progress while executing an approved plan. Actions: complete (mark a step done), uncomplete (undo a completed step), skip (mark a step unnecessary), list (show all steps with status).",
		promptSnippet: "Mark plan steps complete/skipped while executing an approved plan",
		promptGuidelines: [
			"Call plan_step with action 'complete' and the step number immediately after finishing that step - do not batch multiple steps into one call and do not wait until the end of the run.",
			"Call plan_step with action 'skip' for a step that turns out unnecessary, instead of leaving it unmarked.",
		],
		parameters: PlanStepParams,

		async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
			if (params.action === "list") {
				const list = todoItems.map((t) => `${t.step}. [${stepStatusChar(t)}] ${t.text}`).join("\n");
				return {
					content: [{ type: "text", text: todoItems.length > 0 ? list : "No active plan steps." }],
					details: { action: "list" },
				};
			}

			if (params.step === undefined) {
				throw new Error(`plan_step action '${params.action}' requires a step number.`);
			}
			const item = todoItems.find((t) => t.step === params.step);
			if (!item) {
				const known = todoItems.map((t) => t.step).join(", ") || "(none)";
				throw new Error(`No plan step #${params.step}. Known step numbers: ${known}.`);
			}

			switch (params.action) {
				case "complete":
					item.completed = true;
					item.skipped = false;
					break;
				case "uncomplete":
					item.completed = false;
					break;
				case "skip":
					item.skipped = true;
					item.completed = false;
					break;
			}

			updateStatus(ctx);
			persistState();

			return {
				content: [{ type: "text", text: `Step ${item.step} marked ${params.action}: ${item.text}` }],
				details: { action: params.action, step: item.step },
			};
		},

		renderCall(args, theme) {
			let text = theme.fg("toolTitle", theme.bold("plan_step ")) + theme.fg("muted", args.action);
			if (args.step !== undefined) text += ` ${theme.fg("accent", `#${args.step}`)}`;
			return new UiText(text, 0, 0);
		},

		renderResult(result, _options, theme) {
			const first = result.content[0];
			const text = first?.type === "text" ? first.text : "";
			return new UiText(theme.fg("success", "✓ ") + theme.fg("muted", text), 0, 0);
		},
	});

	// Block destructive bash commands in plan mode
	pi.on("tool_call", async (event) => {
		if (!planModeEnabled || event.toolName !== "bash") return;

		const command = event.input.command as string;
		if (!isSafeCommand(command)) {
			return {
				block: true,
				reason: `Plan mode: command blocked (not allowlisted). Use /plan to disable plan mode first.\nCommand: ${command}`,
			};
		}
	});

	// Filter out stale plan mode context when not in plan mode
	pi.on("context", async (event) => {
		if (planModeEnabled) return;

		return {
			messages: event.messages.filter((m) => {
				const msg = m as AgentMessage & { customType?: string };
				if (msg.customType === "plan-mode-context") return false;
				if (msg.role !== "user") return true;

				const content = msg.content;
				if (typeof content === "string") {
					return !content.includes("[PLAN MODE ACTIVE]");
				}
				if (Array.isArray(content)) {
					return !content.some(
						(c) => c.type === "text" && (c as TextContent).text?.includes("[PLAN MODE ACTIVE]"),
					);
				}
				return true;
			}),
		};
	});

	// Inject plan/execution context before agent starts
	pi.on("before_agent_start", async () => {
		if (planModeEnabled) {
			return {
				message: {
					customType: "plan-mode-context",
					content: `[PLAN MODE ACTIVE]
You are in plan mode - a read-only exploration mode for safe code analysis.

Restrictions:
- Built-in edit and write tools are disabled
- Other currently active tools remain available
- Bash is restricted to an allowlist of read-only commands

Ask clarifying questions using the questionnaire tool.
Use brave-search skill via bash for web research.

Create a detailed numbered plan under a "Plan:" header:

Plan:
1. First step description
2. Second step description
...

Do NOT attempt to make changes - just describe what you would do.`,
					display: false,
				},
			};
		}

		if (executionMode && todoItems.length > 0) {
			const remaining = todoItems.filter((t) => !isStepDone(t));
			const todoList = remaining.map((t) => `${t.step}. ${t.text}`).join("\n");
			return {
				message: {
					customType: "plan-execution-context",
					content: `[EXECUTING PLAN - Full tool access enabled]

Remaining steps:
${todoList}

Execute each step in order. Immediately after finishing a step, call the plan_step tool with action "complete" and that step's number - one call per step, right after you finish it. If a step turns out unnecessary, call plan_step with action "skip" instead.`,
					display: false,
				},
			};
		}
	});

	pi.on("turn_end", async () => {
		if (!executionMode || todoItems.length === 0) return;
		// Progress is persisted immediately by the plan_step tool itself; this
		// is just a safety-net snapshot in case a turn ends some other way.
		persistState();
	});

	// Handle plan completion and plan mode UI
	pi.on("agent_end", async (event, ctx) => {
		// Check if execution is complete
		if (executionMode && todoItems.length > 0) {
			if (todoItems.every(isStepDone)) {
				const completedList = todoItems.map((t) => (t.skipped ? `~~${t.text}~~ (skipped)` : `~~${t.text}~~`)).join("\n");
				pi.sendMessage(
					{ customType: "plan-complete", content: `**Plan Complete!** ✓\n\n${completedList}`, display: true },
					{ triggerTurn: false },
				);
				endExecution(ctx);
				return;
			}

			// Not all steps are marked done. If the run actually stopped (the last
			// assistant message made no tool calls), the model has finished
			// responding - it likely completed the work but never called
			// plan_step. Without this check, execution state gets stuck forever:
			// no completion message ever shows, and before_agent_start keeps
			// re-injecting "execute the plan" on every future turn/resume, which
			// can make the model think it needs to redo already-finished work.
			if (!ctx.hasUI) return;
			const lastAssistant = [...event.messages].reverse().find(isAssistantMessage);
			if (!lastAssistant || hasToolCalls(lastAssistant)) return;

			const remaining = todoItems.filter((t) => !isStepDone(t));
			const choice = await ctx.ui.select(
				`Plan execution stopped with ${remaining.length} step(s) not marked done. What happened?`,
				["All steps are actually done", "Resume execution", "Adjust steps manually", "Stop and exit"],
			);

			if (choice === "All steps are actually done") {
				for (const t of todoItems) t.completed = true;
				const completedList = todoItems.map((t) => `~~${t.text}~~`).join("\n");
				pi.sendMessage(
					{ customType: "plan-complete", content: `**Plan Complete!** ✓\n\n${completedList}`, display: true },
					{ triggerTurn: false },
				);
				endExecution(ctx);
			} else if (choice === "Stop and exit") {
				endExecution(ctx);
			} else if (choice === "Adjust steps manually") {
				await showTodoEditor(ctx);
			} else if (choice === "Resume execution") {
				const remainingList = remaining.map((t) => `${t.step}. ${t.text}`).join("\n");
				pi.sendMessage(
					{
						customType: "plan-mode-execute",
						content: `Resume the plan.\n\nRemaining steps:\n${remainingList}\n\nImmediately after finishing a step, call the plan_step tool with action "complete" and that step's number.`,
						display: true,
					},
					{ triggerTurn: true, deliverAs: "followUp" },
				);
			}
			// No selection (dismissed): leave state as-is.
			return;
		}

		if (!planModeEnabled || !ctx.hasUI) return;

		// Extract todos from last assistant message
		const lastAssistant = [...event.messages].reverse().find(isAssistantMessage);
		if (lastAssistant) {
			const extracted = extractTodoItems(getTextContent(lastAssistant));
			if (extracted.length > 0) {
				todoItems = extracted;
			}
		}

		if (todoItems.length === 0) return;
		persistState();

		// Show plan steps and prompt for next action
		const todoListText = todoItems.map((t, i) => `${i + 1}. [ ] ${t.text}`).join("\n");
		const planTodoListMessage = {
			customType: "plan-todo-list",
			content: `**Plan Steps (${todoItems.length}):**\n\n${todoListText}`,
			display: true,
		};

		const choice = await ctx.ui.select("Plan mode - what next?", [
			"Execute the plan (track progress)",
			"Stay in plan mode",
			"Refine the plan",
		]);

		if (choice?.startsWith("Execute")) {
			const firstTodoItem = todoItems[0];
			if (!firstTodoItem) return;

			planModeEnabled = false;
			executionMode = true;
			enableExecutionTools();
			updateStatus(ctx);
			persistState();

			const remainingList = todoItems.map((t) => `${t.step}. ${t.text}`).join("\n");
			const execMessage = `Execute the plan.

Remaining steps:
${remainingList}

Start with: ${firstTodoItem.text}
Immediately after finishing a step, call the plan_step tool with action "complete" and that step's number.`;
			pi.sendMessage(planTodoListMessage, { deliverAs: "followUp" });
			pi.sendMessage(
				{ customType: "plan-mode-execute", content: execMessage, display: true },
				{ triggerTurn: true, deliverAs: "followUp" },
			);
		} else if (choice === "Refine the plan") {
			const refinement = await ctx.ui.editor("Refine the plan:", "");
			if (refinement?.trim()) {
				pi.sendMessage(planTodoListMessage, { deliverAs: "followUp" });
				pi.sendUserMessage(refinement.trim(), { deliverAs: "followUp" });
			}
		}
	});

	// Restore state on session start/resume
	pi.on("session_start", async (_event, ctx) => {
		if (pi.getFlag("plan") === true) {
			planModeEnabled = true;
		}

		const entries = ctx.sessionManager.getEntries();

		// Restore persisted state
		const planModeEntry = entries
			.filter((e: { type: string; customType?: string }) => e.type === "custom" && e.customType === "plan-mode")
			.pop() as { data?: PlanModeState } | undefined;

		if (planModeEntry?.data) {
			planModeEnabled = planModeEntry.data.enabled ?? planModeEnabled;
			todoItems = planModeEntry.data.todos ?? todoItems;
			executionMode = planModeEntry.data.executing ?? executionMode;
			toolsBeforePlanMode = planModeEntry.data.toolsBeforePlanMode ?? toolsBeforePlanMode;
			widgetCollapsed = planModeEntry.data.widgetCollapsed ?? widgetCollapsed;
		}

		if (planModeEnabled) {
			enablePlanModeTools();
		} else if (executionMode) {
			pi.setActiveTools(uniqueToolNames([...pi.getActiveTools(), PLAN_STEP_TOOL]));
		}
		updateStatus(ctx);
	});
}
