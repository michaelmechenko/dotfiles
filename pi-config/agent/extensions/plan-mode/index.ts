import type { AgentMessage } from "@earendil-works/pi-agent-core";
import type { AssistantMessage } from "@earendil-works/pi-ai";
import { StringEnum } from "@earendil-works/pi-ai";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { getAgentDir } from "@earendil-works/pi-coding-agent";
import { Key, matchesKey, Text as UiText, truncateToWidth } from "@earendil-works/pi-tui";
import { Type } from "typebox";
import { loadPlanModeConfig } from "./config.ts";
import {
	applyPlanUpdate,
	canClosePlan,
	createPlanState,
	isStepDone,
	pendingSteps,
	type ModelSnapshot,
	type PlanCloseout,
	type PlanState,
} from "./plan-state.ts";
import { deletePlanFile, readPlanFile, writePlanFile } from "./plan-file.ts";
import { isSafeCommand, parsePlanEditText, type TodoItem } from "./utils.ts";

const PLAN_STEP_TOOL = "plan_step";
const PLAN_UPDATE_TOOL = "plan_update";
const PLAN_COMPLETE_TOOL = "plan_complete";
const READ_ONLY_TOOLS = new Set([
	"read", "bash", "grep", "find", "ls", "webfetch", "websearch", "lsp", "ast_grep",
	"session_search", "session_query", "ask_user",
]);
const PLAN_TOOLS = [PLAN_STEP_TOOL, PLAN_UPDATE_TOOL, PLAN_COMPLETE_TOOL];
const THINKING_LEVELS = ["off", "minimal", "low", "medium", "high", "xhigh", "max"] as const;
type ThinkingLevel = (typeof THINKING_LEVELS)[number];

const PlanStepParams = Type.Object({
	action: StringEnum(["complete", "uncomplete", "skip", "list"] as const),
	step: Type.Optional(Type.Integer({ minimum: 1, description: "1-indexed plan step number." })),
});
const PlanUpdateParams = Type.Object({
	goal: Type.String({ minLength: 1, description: "The user outcome this plan achieves." }),
	steps: Type.Array(Type.String({ minLength: 1 }), { minItems: 1, description: "Top-level executable steps only; do not include nested substeps." }),
	criteria: Type.Optional(Type.Array(Type.String({ minLength: 1 }), { description: "Verification or acceptance criteria." })),
	followUps: Type.Optional(Type.Array(Type.String({ minLength: 1 }), { description: "Concrete work after this plan, if any." })),
});
const PlanCompleteParams = Type.Object({
	outcome: Type.String({ minLength: 1, description: "Concise statement of what was accomplished." }),
	endState: Type.String({ minLength: 1, description: "Current state of the code or configuration." }),
	verification: Type.Array(Type.String({ minLength: 1 }), { minItems: 1, description: "Checks performed and their result." }),
	deviations: Type.Optional(Type.Array(Type.String({ minLength: 1 }), { description: "Scope changes, skipped work, or blockers." })),
	nextSteps: Type.Optional(Type.Array(Type.String({ minLength: 1 }), { description: "Concrete follow-on work." })),
});

function isAssistantMessage(message: AgentMessage): message is AssistantMessage {
	return message.role === "assistant" && Array.isArray(message.content);
}

function statusChar(step: TodoItem): string {
	return step.completed ? "x" : step.skipped ? "-" : " ";
}

function formatSteps(steps: TodoItem[]): string {
	return steps.map((step) => `${step.step}. [${statusChar(step)}] ${step.text}`).join("\n");
}

function snapshotModel(ctx: ExtensionContext): ModelSnapshot | undefined {
	if (!ctx.model) return undefined;
	return {
		provider: ctx.model.provider,
		model: ctx.model.id,
		thinkingLevel: ctx.thinkingLevel as ThinkingLevel,
	};
}

export default function planModeExtension(pi: ExtensionAPI): void {
	let state = createPlanState();
	let sessionId = "";
	let handledStoppedAssistantTimestamp: number | undefined;
	const agentDir = getAgentDir();

	function persist(): void {
		pi.appendEntry("plan-mode", state);
		if (state.steps.length > 0 && sessionId) writePlanFile(agentDir, sessionId, state.steps);
	}

	function setTools(names: string[]): void {
		pi.setActiveTools([...new Set(names)]);
	}

	function enterReadOnly(): void {
		if (!state.toolsBeforePlan) {
			state = { ...state, toolsBeforePlan: pi.getActiveTools().filter((name) => !PLAN_TOOLS.includes(name)) };
		}
		const available = new Set(pi.getAllTools().map((tool) => tool.name));
		setTools([...READ_ONLY_TOOLS, PLAN_UPDATE_TOOL].filter((name) => available.has(name)));
	}

	function enterExecutionTools(): void {
		setTools([...(state.toolsBeforePlan ?? pi.getActiveTools()), ...PLAN_TOOLS]);
	}

	function restoreTools(): void {
		if (state.toolsBeforePlan) setTools(state.toolsBeforePlan);
		else setTools(pi.getActiveTools().filter((name) => !PLAN_TOOLS.includes(name)));
	}

	async function setModel(snapshot: ModelSnapshot | undefined, ctx: ExtensionContext, purpose: string): Promise<boolean> {
		if (!snapshot) return false;
		const model = ctx.modelRegistry.find(snapshot.provider, snapshot.model);
		if (!model || !(await pi.setModel(model))) {
			ctx.ui.notify(`Plan ${purpose} model ${snapshot.provider}/${snapshot.model} is unavailable; keeping the current model.`, "warning");
			return false;
		}
		pi.setThinkingLevel(snapshot.thinkingLevel);
		return true;
	}

	async function restorePlanningModel(ctx: ExtensionContext): Promise<void> {
		await setModel(state.planningModel, ctx, "planning");
	}

	async function setExecutionModel(ctx: ExtensionContext): Promise<void> {
		await setModel(loadPlanModeConfig().executionModel, ctx, "execution");
	}

	function updateUi(ctx: ExtensionContext): void {
		if (state.phase === "executing" && state.steps.length > 0) {
			const done = state.steps.filter(isStepDone).length;
			ctx.ui.setStatus("plan-mode", ctx.ui.theme.fg("accent", `plan ${done}/${state.steps.length}`));
		} else if (state.phase === "planning" || state.phase === "revising") {
			ctx.ui.setStatus("plan-mode", ctx.ui.theme.fg("warning", state.phase === "revising" ? "plan (recalibrating)" : "plan (planning)"));
		} else if (state.phase === "paused") {
			ctx.ui.setStatus("plan-mode", ctx.ui.theme.fg("warning", "plan (paused)"));
		} else {
			ctx.ui.setStatus("plan-mode", undefined);
		}

		if (state.phase !== "executing" || state.steps.length === 0) {
			ctx.ui.setWidget("plan-todos", undefined);
			return;
		}
		const theme = ctx.ui.theme;
		const done = state.steps.filter(isStepDone).length;
		if (state.widgetCollapsed) {
			const next = pendingSteps(state)[0];
			ctx.ui.setWidget("plan-todos", [
				next
					? `${theme.fg("accent", `plan ${done}/${state.steps.length}`)} ${theme.fg("muted", "—")} ${next.text}`
					: `${theme.fg("accent", `plan ${done}/${state.steps.length}`)} ${theme.fg("muted", "— finalizing closeout")}`,
			]);
			return;
		}
		ctx.ui.setWidget("plan-todos", state.steps.map((step) => {
			if (step.completed) return theme.fg("success", "[x] ") + theme.fg("muted", theme.strikethrough(step.text));
			if (step.skipped) return theme.fg("dim", "[-] ") + theme.fg("dim", theme.strikethrough(step.text));
			return `${theme.fg("muted", "[ ] ")}${step.text}`;
		}));
	}

	function planContext(): string {
		return `Goal: ${state.goal}\n\nSteps:\n${formatSteps(state.steps)}${state.criteria.length ? `\n\nVerification criteria:\n${state.criteria.map((item) => `- ${item}`).join("\n")}` : ""}${state.followUps.length ? `\n\nKnown follow-up work:\n${state.followUps.map((item) => `- ${item}`).join("\n")}` : ""}`;
	}

	function showPlan(ctx: ExtensionContext): void {
		pi.sendMessage({ customType: "plan-todo-list", content: `## Current plan\n\n${planContext()}`, display: true }, { triggerTurn: false });
		updateUi(ctx);
	}

	async function beginExecution(ctx: ExtensionContext): Promise<void> {
		if (state.steps.length === 0) return;
		if (!state.planningModel) state = { ...state, planningModel: snapshotModel(ctx) };
		state = { ...state, phase: "executing", awaitingReview: false, resumeAfterRevision: false, completionRequested: false };
		enterExecutionTools();
		await setExecutionModel(ctx);
		persist();
		showPlan(ctx);
		pi.sendMessage({
			customType: "plan-mode-execute",
			content: `[EXECUTING PLAN]\n${planContext()}\n\nExecute only pending steps in order. Call plan_step immediately after each completed or skipped step. If scope or blockers invalidate pending work, inspect current state then call plan_update with the revised top-level steps. After every step is terminal, call plan_complete with outcome, end state, verification, deviations, and next steps.`,
			display: true,
		}, { triggerTurn: true, deliverAs: "followUp" });
	}

	async function requestRevision(ctx: ExtensionContext, request?: string): Promise<void> {
		if (!ctx.hasUI) return;
		const changeRequest = request ?? await ctx.ui.editor("Recalibrate this plan:", "");
		if (!changeRequest?.trim()) return;
		state = { ...state, phase: "revising", awaitingReview: false, resumeAfterRevision: true, completionRequested: false };
		enterReadOnly();
		await restorePlanningModel(ctx);
		persist();
		updateUi(ctx);
		pi.sendUserMessage(`Recalibrate the active plan from the current state.\n\n${planContext()}\n\nUser requested changes:\n${changeRequest.trim()}\n\nInspect as needed without changing files. Then call plan_update with a revised goal and top-level steps. Preserve completed work; replace only pending work. Execution resumes automatically after the update.`, { deliverAs: "followUp" });
	}

	async function pause(ctx: ExtensionContext): Promise<void> {
		if (!state.steps.length) return;
		state = { ...state, phase: "paused", awaitingReview: false, resumeAfterRevision: false };
		restoreTools();
		await restorePlanningModel(ctx);
		persist();
		updateUi(ctx);
		ctx.ui.notify("Plan paused. Run /plan-review to resume or recalibrate.", "info");
	}

	async function closePlan(ctx: ExtensionContext, closeout: PlanCloseout): Promise<void> {
		const planningModel = state.planningModel;
		const completeState = { ...state, closeout };
		pi.sendMessage({
			customType: "plan-complete",
			content: `## Plan complete\n\n**Goal:** ${completeState.goal}\n\n**Outcome:** ${closeout.outcome}\n\n**End state:** ${closeout.endState}\n\n**Verification:**\n${closeout.verification.map((item) => `- ${item}`).join("\n")}\n\n**Deviations:**\n${(closeout.deviations.length ? closeout.deviations : ["None."]).map((item) => `- ${item}`).join("\n")}\n\n**Next steps:**\n${(closeout.nextSteps.length ? closeout.nextSteps : completeState.followUps.length ? completeState.followUps : ["No further work identified."]).map((item) => `- ${item}`).join("\n")}`,
			display: true,
		}, { triggerTurn: false });
		state = createPlanState();
		restoreTools();
		await setModel(planningModel, ctx, "planning");
		if (sessionId) deletePlanFile(agentDir, sessionId);
		persist();
		updateUi(ctx);
	}

	function startPlanning(ctx: ExtensionContext): void {
		state = { ...state, phase: "planning", planningModel: snapshotModel(ctx), awaitingReview: false };
		enterReadOnly();
		persist();
		updateUi(ctx);
		ctx.ui.notify("Plan mode enabled. Read-only tools are active.", "info");
	}

	async function reviewPlan(ctx: ExtensionContext): Promise<void> {
		if (state.steps.length === 0) {
			startPlanning(ctx);
			return;
		}
		const choice = await ctx.ui.select("Current plan", [
			"Execute or resume",
			"Recalibrate from current state",
			"Edit steps manually",
			"Pause plan",
			"Discard plan",
		]);
		if (choice === "Execute or resume") await beginExecution(ctx);
		else if (choice === "Recalibrate from current state") await requestRevision(ctx);
		else if (choice === "Edit steps manually") {
			const text = await ctx.ui.editor("Edit top-level plan steps:", state.steps.map((step) => `${step.step}. ${step.text}`).join("\n"));
			if (text) {
				const steps = parsePlanEditText(text);
				if (steps.length) {
					state = applyPlanUpdate(state, { goal: state.goal, steps, criteria: state.criteria, followUps: state.followUps });
					persist();
					showPlan(ctx);
				}
			}
		} else if (choice === "Pause plan") await pause(ctx);
		else if (choice === "Discard plan") {
			state = createPlanState();
			restoreTools();
			if (sessionId) deletePlanFile(agentDir, sessionId);
			persist();
			updateUi(ctx);
		}
	}

	async function showTodos(ctx: ExtensionContext): Promise<void> {
		if (state.steps.length === 0) return;
		if (!ctx.hasUI) {
			ctx.ui.notify(formatSteps(state.steps), "info");
			return;
		}
		await ctx.ui.custom<void>((tui, theme, _kb, done) => {
			let index = 0;
			let cache: string[] | undefined;
			const refresh = () => { cache = undefined; tui.requestRender(); };
			const cycle = (step: TodoItem) => {
				if (!step.completed && !step.skipped) step.completed = true;
				else if (step.completed) { step.completed = false; step.skipped = true; }
				else step.skipped = false;
				persist(); updateUi(ctx);
			};
			return {
				render(width) {
					if (cache) return cache;
					const lines = [theme.fg("accent", " Plan Progress ")];
					state.steps.forEach((step, i) => lines.push(truncateToWidth(`${i === index ? theme.fg("accent", " ❯ ") : "   "}${step.completed ? theme.fg("success", "[x] ") : step.skipped ? theme.fg("dim", "[-] ") : theme.fg("muted", "[ ] ")}${step.text}`, width)));
					lines.push(theme.fg("dim", " ↑↓ navigate • space cycle status • esc close"));
					cache = lines; return lines;
				},
				invalidate() { cache = undefined; },
				handleInput(data) {
					if (matchesKey(data, Key.escape) || matchesKey(data, "ctrl+c")) return done();
					if (matchesKey(data, Key.up)) { index = (index - 1 + state.steps.length) % state.steps.length; refresh(); }
					else if (matchesKey(data, Key.down)) { index = (index + 1) % state.steps.length; refresh(); }
					else if (matchesKey(data, Key.space) || matchesKey(data, Key.enter)) { cycle(state.steps[index]); refresh(); }
				},
			};
		});
	}

	pi.registerFlag("plan", { description: "Start in read-only plan mode", type: "boolean", default: false });
	pi.registerCommand("plan", { description: "Enter plan mode, or pause an active plan", handler: async (_args, ctx) => {
		if (state.phase === "planning" || state.phase === "revising") { await pause(ctx); return; }
		if (state.phase === "executing") { await pause(ctx); return; }
		if (state.steps.length) { await reviewPlan(ctx); return; }
		startPlanning(ctx);
	} });
	pi.registerCommand("plan-review", { description: "Execute, recalibrate, pause, or discard the active plan", handler: async (_args, ctx) => reviewPlan(ctx) });
	pi.registerCommand("plan-edit", { description: "Edit top-level steps in the active plan", handler: async (_args, ctx) => {
		if (!state.steps.length) return ctx.ui.notify("No active plan.", "info");
		const text = await ctx.ui.editor("Edit top-level plan steps:", state.steps.map((step) => `${step.step}. ${step.text}`).join("\n"));
		if (!text) return;
		const steps = parsePlanEditText(text);
		if (!steps.length) return ctx.ui.notify("No steps found; plan unchanged.", "warning");
		state = applyPlanUpdate(state, { goal: state.goal, steps, criteria: state.criteria, followUps: state.followUps });
		persist(); showPlan(ctx);
	} });
	pi.registerCommand("plan-widget", { description: "Toggle collapsed plan progress", handler: async (_args, ctx) => {
		state = { ...state, widgetCollapsed: !state.widgetCollapsed }; persist(); updateUi(ctx);
	} });
	pi.registerCommand("todos", { description: "View or correct plan progress", handler: async (_args, ctx) => showTodos(ctx) });
	pi.registerCommand("pause", { description: "Pause plan execution", handler: async (_args, ctx) => pause(ctx) });
	pi.registerShortcut(Key.ctrl("p"), { description: "Enter plan mode or open the active plan workflow", handler: async (ctx) => {
		if (state.phase === "idle" && state.steps.length === 0) startPlanning(ctx);
		else await reviewPlan(ctx);
	} });
	pi.registerShortcut(Key.ctrlAlt("p"), { description: "Toggle collapsed plan progress", handler: async (ctx) => {
		state = { ...state, widgetCollapsed: !state.widgetCollapsed }; persist(); updateUi(ctx);
	} });
	pi.registerShortcut(Key.ctrlAlt("t"), { description: "Toggle collapsed plan progress", handler: async (ctx) => {
		state = { ...state, widgetCollapsed: !state.widgetCollapsed }; persist(); updateUi(ctx);
	} });

	pi.registerTool({
		name: PLAN_UPDATE_TOOL,
		label: "Plan Update",
		description: "Create the initial structured plan or revise pending work when scope or blockers change.",
		promptSnippet: "Create or revise the structured active plan",
		promptGuidelines: ["Call plan_update after planning and whenever scope or blockers change pending work. Pass only top-level executable steps; preserve completed work by keeping its text unchanged."],
		parameters: PlanUpdateParams,
		async execute(_id, params, _signal, _update, ctx) {
			if (state.phase !== "planning" && state.phase !== "revising" && state.phase !== "executing") throw new Error("plan_update requires an active planning or execution workflow.");
			state = applyPlanUpdate(state, params);
			if (state.phase === "revising" && state.resumeAfterRevision) await beginExecution(ctx);
			persist(); updateUi(ctx);
			return { content: [{ type: "text", text: `Plan updated with ${state.steps.length} step(s).\n${planContext()}` }], details: { state } };
		},
	});

	pi.registerTool({
		name: PLAN_STEP_TOOL,
		label: "Plan Step",
		description: "Track an approved plan step during execution.",
		promptSnippet: "Mark an executing plan step complete or skipped",
		promptGuidelines: ["Call plan_step immediately after each executed or skipped step. Do not batch plan_step calls."],
		parameters: PlanStepParams,
		async execute(_id, params, _signal, _update, ctx) {
			if (state.phase !== "executing") throw new Error("plan_step is available only while executing a plan.");
			if (params.action === "list") return { content: [{ type: "text", text: formatSteps(state.steps) }], details: { state } };
			if (params.step === undefined) throw new Error(`plan_step '${params.action}' requires a step.`);
			const step = state.steps.find((item) => item.step === params.step);
			if (!step) throw new Error(`No plan step #${params.step}. Known: ${state.steps.map((item) => item.step).join(", ")}.`);
			if (params.action === "complete") { step.completed = true; step.skipped = false; }
			else if (params.action === "skip") { step.completed = false; step.skipped = true; }
			else { step.completed = false; step.skipped = false; }
			persist(); updateUi(ctx);
			return { content: [{ type: "text", text: `Step ${step.step} marked ${params.action}: ${step.text}` }], details: { state } };
		},
	});

	pi.registerTool({
		name: PLAN_COMPLETE_TOOL,
		label: "Plan Complete",
		description: "Close an executed plan with its outcome, verified end state, deviations, and follow-up work.",
		promptSnippet: "Record the final plan outcome and next steps",
		promptGuidelines: ["Call plan_complete after every plan step is completed or skipped. Include the outcome, current end state, concrete verification, deviations, and next steps."],
		parameters: PlanCompleteParams,
		async execute(_id, params, _signal, _update, ctx) {
			if (!canClosePlan(state)) throw new Error("plan_complete requires every plan step to be completed or skipped.");
			const closeout: PlanCloseout = { ...params, deviations: params.deviations ?? [], nextSteps: params.nextSteps ?? [] };
			await closePlan(ctx, closeout);
			return { content: [{ type: "text", text: "Plan closeout recorded." }], details: { closeout } };
		},
	});

	pi.on("tool_call", async (event) => {
		if ((state.phase !== "planning" && state.phase !== "revising") || event.toolName !== "bash") return;
		if (!isSafeCommand(event.input.command as string)) return { block: true, reason: "Plan mode allows only read-only bash commands." };
	});

	pi.on("context", async (event) => {
		if (state.phase === "planning" || state.phase === "revising") return;
		return { messages: event.messages.filter((message) => (message as { customType?: string }).customType !== "plan-mode-context") };
	});

	pi.on("before_agent_start", async () => {
		if (state.phase === "planning" || state.phase === "revising") return { message: {
			customType: "plan-mode-context",
			content: `[PLAN MODE: READ ONLY]\nUse only the active read-only tools. Investigate before proposing work. Ask a focused clarification when needed, including the finding that made it necessary and the decision it affects. When ready, call plan_update with a goal, only top-level executable steps, verification criteria, and follow-up work. Do not edit files or emit a free-text plan as the authoritative plan.`,
			display: false,
		} };
		if (state.phase === "executing") return { message: {
			customType: "plan-execution-context",
			content: `[PLAN EXECUTION]\n${planContext()}\n\nExecute pending steps in order. Call plan_step after each step. Use plan_update when blockers or scope changes alter pending work. When all steps are terminal, call plan_complete; do not end with an unstructured summary.`,
			display: false,
		} };
	});

	pi.on("agent_settled", async (_event, ctx) => {
		if (state.phase === "planning" && state.awaitingReview && state.steps.length) {
			state = { ...state, awaitingReview: false }; persist(); showPlan(ctx);
			const choice = await ctx.ui.select("Plan ready", ["Execute plan", "Recalibrate plan", "Stay in plan mode"]);
			if (choice === "Execute plan") await beginExecution(ctx);
			else if (choice === "Recalibrate plan") await requestRevision(ctx);
			return;
		}
		if (state.phase !== "executing") return;
		const lastAssistant = [...ctx.sessionManager.getBranch()].reverse().find((entry) => entry.type === "message" && isAssistantMessage(entry.message as AgentMessage)) as { message: AssistantMessage } | undefined;
		if (!lastAssistant) return;
		if (!canClosePlan(state) && lastAssistant.message.timestamp !== handledStoppedAssistantTimestamp) {
			handledStoppedAssistantTimestamp = lastAssistant.message.timestamp;
			const current = pendingSteps(state)[0];
			const reason = lastAssistant.message.stopReason === "error"
				? `Execution stopped after retries: ${lastAssistant.message.errorMessage ?? "unknown provider error"}`
				: lastAssistant.message.stopReason === "aborted"
					? "Execution interrupted"
					: "Execution stopped before all plan steps were terminal";
			const choice = await ctx.ui.select(`${reason}${current ? `\n\nCurrent step ${current.step}: ${current.text}` : ""}`, ["Resume current step", "Recalibrate plan", "Adjust statuses", "Pause plan"]);
			if (choice === "Resume current step") pi.sendMessage({ customType: "plan-resume", content: `Resume the current pending step.\n\n${planContext()}`, display: true }, { triggerTurn: true, deliverAs: "followUp" });
			else if (choice === "Recalibrate plan") await requestRevision(ctx);
			else if (choice === "Adjust statuses") await showTodos(ctx);
			else if (choice === "Pause plan") await pause(ctx);
			return;
		}
		if (canClosePlan(state) && !state.completionRequested) {
			state = { ...state, completionRequested: true }; persist();
			pi.sendMessage({ customType: "plan-closeout-request", content: "All plan steps are terminal. Call plan_complete now with the outcome, end state, verification, deviations, and next steps.", display: true }, { triggerTurn: true, deliverAs: "followUp" });
		}
	});

	pi.on("session_start", async (_event, ctx) => {
		sessionId = ctx.sessionManager.getSessionId();
		const entry = [...ctx.sessionManager.getBranch()].reverse().find((item) => item.type === "custom" && item.customType === "plan-mode") as { data?: Partial<PlanState> } | undefined;
		if (entry?.data?.version === 2) state = { ...createPlanState(), ...entry.data };
		else {
			const legacySteps = readPlanFile(agentDir, sessionId);
			if (legacySteps.length) state = { ...createPlanState(), phase: "paused", steps: legacySteps };
		}
		if (pi.getFlag("plan") === true && state.phase === "idle") state = { ...state, phase: "planning", planningModel: snapshotModel(ctx) };
		if (state.phase === "planning" || state.phase === "revising") enterReadOnly();
		else if (state.phase === "executing") enterExecutionTools();
		else setTools(pi.getActiveTools().filter((name) => !PLAN_TOOLS.includes(name)));
		updateUi(ctx);
	});
	pi.on("session_shutdown", async (_event, ctx) => {
		if (state.phase === "executing" || state.phase === "revising") await restorePlanningModel(ctx);
	});
}
