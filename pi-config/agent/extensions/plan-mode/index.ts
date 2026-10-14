import { AsyncLocalStorage } from "node:async_hooks";
import { randomUUID } from "node:crypto";
import type { AgentMessage } from "@earendil-works/pi-agent-core";
import { getSupportedThinkingLevels, StringEnum, type AssistantMessage } from "@earendil-works/pi-ai";
import { copyToClipboard, getAgentDir, getSettingsListTheme, type ExtensionAPI, type ExtensionCommandContext, type ExtensionContext } from "@earendil-works/pi-coding-agent";
import { Container, Key, matchesKey, type SettingItem, SettingsList, truncateToWidth } from "@earendil-works/pi-tui";
import { Type } from "typebox";
import { inspectSavedExecutionModel, isModelSnapshot, loadPlanModeConfig, savePlanModeConfig, type SavedExecutionModelState } from "./config.ts";
import { acknowledgeExecutionPacket, buildTmuxDetachedPaneArgs, buildTmuxNewWindowArgs, cancelUnclaimedExecutionPacket, consumeExecutionPacket, deleteExecutionPacket, executionOwner, finishRecoveredExecutionPacket, reclaimDeadExecutionPacket, recoveredExecutionPacketFinished, renderPlanMarkdown, validateExecutionClaim, waitForExecutionAcknowledgement, type TmuxTarget, writeExecutionPacket } from "./execution-handoff.ts";
import { executionGuidance, renderExecutionContext } from "./execution-context.ts";
import { decideExecutionContinuation, resetExecutionContinuation } from "./execution-continuation.ts";
import { candidateFor, createExecutionSettings, cycleExecutionSettingValue, defaultExecutionDestination, resolveExecutionSettings, retainSelectedExecutionRow, type ExecutionDestination, type ExecutionSettings, type ModelCandidate } from "./execution-settings.ts";
import { canUpdateTrackedPlan, createInternalPlan, latestInternalPlan, resolvePlanUpdateScope, type InternalPlan } from "./internal-plan.ts";
import { deletePlanFile, readPlanFile, writePlanFile } from "./plan-file.ts";
import { publishLivePlan, removeLivePlan } from "./live-plan.ts";
import { PlanLifecycle, PlanMutationQueue, lifecycleGuard, restorePlanLifecycle, transitionPlanLifecycle, type LifecycleToken } from "./lifecycle.ts";
import { applyPlanUpdate, canClosePlan, closeoutExecutionIdentity, closeoutMatches, clonePlanState, createPlanState, isExecutionWait, isStepDone, leaveRestrictedMode, materializePlan, migratePlanState, pendingSteps, updatePlanStep, type CurrentPaneTransfer, type DetachedHandoffIntent, type ExecutionWait, type ModelSnapshot, type PlanCloseout, type PlanState, type ThinkingLevel, type TrackedPlanStepInput } from "./plan-state.ts";
import { archiveCompletedPlan, completedPlanRecord, listCompletedPlansForSession, resolvePlanProject, watchCompletedPlans, type PlanProject } from "./plan-history.ts";
import { planFooterStatus } from "./plan-status.ts";
import { checkRestrictedToolCall, PLAN_EXECUTION_TOOLS, PLAN_UPDATE_TOOL, restrictedTools, restrictionGuidance } from "./restricted-mode.ts";
import { buildRecalibrationMessage, promptForRecalibration } from "./recalibration-editor.ts";
import { renderExecutionSettingsHeader, renderPlanProgress } from "./tui-rendering.ts";
import { parsePlanEditEntries, type TodoItem } from "./utils.ts";
import { processStartToken } from "../session-state/process-identity.ts";

const PLAN_STEP_TOOL = "plan_step";
const PLAN_COMPLETE_TOOL = "plan_complete";
const CONTEXT_TYPES = new Set(["plan-mode-context", "read-only-mode-context"]);

const PlanStepParams = Type.Object({
	action: StringEnum(["complete", "uncomplete", "skip", "list"] as const),
	step: Type.Optional(Type.Integer({ minimum: 1 })),
});
const PlanUpdateParams = Type.Object({
	scope: Type.Optional(StringEnum(["internal", "tracked"] as const)),
	goal: Type.String({ minLength: 1 }), steps: Type.Array(Type.Union([Type.String({ minLength: 1 }), Type.Object({ id: Type.Optional(Type.String({ minLength: 1 })), text: Type.String({ minLength: 1 }) })]), { minItems: 1 }),
	criteria: Type.Optional(Type.Array(Type.String({ minLength: 1 }))), followUps: Type.Optional(Type.Array(Type.String({ minLength: 1 }))),
	executionBrief: Type.Object({ summary: Type.String({ minLength: 1 }), findings: Type.Array(Type.String({ minLength: 1 })), decisions: Type.Array(Type.String({ minLength: 1 })), relevantFiles: Type.Array(Type.Object({ path: Type.String({ minLength: 1 }), note: Type.String({ minLength: 1 }) })), constraints: Type.Array(Type.String({ minLength: 1 })) }),
	executionWait: Type.Optional(Type.Union([Type.Null(), Type.Object({ kind: StringEnum(["input", "permission", "external", "budget"] as const), reason: Type.String({ minLength: 1 }) })])),
});
const PlanCompleteParams = Type.Object({
	outcome: Type.String({ minLength: 1 }),
	endState: Type.String({ minLength: 1 }),
	verification: Type.Array(Type.String({ minLength: 1 }), { minItems: 1 }),
	deviations: Type.Optional(Type.Array(Type.String({ minLength: 1 }))),
	nextSteps: Type.Optional(Type.Array(Type.String({ minLength: 1 }))),
});

function snapshotModel(ctx: ExtensionContext): ModelSnapshot | undefined {
	return ctx.model ? { provider: ctx.model.provider, model: ctx.model.id, thinkingLevel: ctx.thinkingLevel as ThinkingLevel } : undefined;
}
function formatSteps(steps: TodoItem[]): string {
	return steps.map((step) => `${step.step}. [${step.completed ? "x" : step.skipped ? "-" : " "}] ${step.text} (id: ${step.id})`).join("\n");
}
function isAssistantMessage(message: AgentMessage): message is AssistantMessage {
	return message.role === "assistant" && Array.isArray(message.content);
}

/** Boundary outcome reports this turn's completion; an assistant stop reason still vetoes recovery. */
function assistantCompleted(message: AssistantMessage | undefined): boolean {
	return !message || (message.stopReason !== "aborted" && message.stopReason !== "error" && message.stopReason !== "pending" && message.stopReason !== "deferred");
}

type InternalModelCall = <T>(call: () => T) => T;

/** Switch only this live session; Pi persists defaults only through its settings APIs. */
export async function setSessionModel(pi: ExtensionAPI, ctx: ExtensionContext, model: ModelSnapshot, isCurrent: () => boolean = () => true, internalCall: InternalModelCall = (call) => call()): Promise<boolean> {
	if (!isCurrent()) return false;
	const current = snapshotModel(ctx);
	if (current?.provider === model.provider && current.model === model.model && current.thinkingLevel === model.thinkingLevel) return true;
	const resolved = ctx.modelRegistry.find(model.provider, model.model);
	if (!resolved || !isCurrent()) return false;
	try {
		const changed = await internalCall(() => pi.setModel(resolved));
		// Pi authenticates before mutating the live model. Revalidate after it returns:
		// a user selection made while it awaited authentication has already queued its repair.
		if (!changed || !isCurrent()) return false;
		internalCall(() => pi.setThinkingLevel(model.thinkingLevel));
		return true;
	} catch { return false; }
}

export default function planModeExtension(pi: ExtensionAPI): void {
	let state = createPlanState();
	let internalPlan: InternalPlan | undefined;
	let sessionId = "";
	let sessionFile: string | undefined;
	let sessionCwd = "";
	let activeHandoff: { path: string; claimToken: string } | undefined;
	let handledStoppedAssistantTimestamp: number | undefined;
	let closeoutAttempt: { planId: string; terminalEpoch: number; executionId: string } | undefined;
	let project: PlanProject | undefined;
	let completedPlanCount = 0;
	let closeHistoryWatcher: (() => void) | undefined;
	let historyRefreshTimer: ReturnType<typeof setTimeout> | undefined;
	let revision = 0;
	const lifecycle = new PlanLifecycle();
	const mutations = new PlanMutationQueue();
	// Model changes are asynchronous session effects, not state commits. Keep their
	// ordering independent from the short synchronous mutation queue.
	let modelEffects: Promise<void> = Promise.resolve();
	let modelIntent = 0;
	// Pi's setters dispatch extension events inline. Attribute only calls made by
	// this effect, never a coincidentally identical provider/model selected in the UI.
	type ModelOperation = { sessionId: string; sessionManager: ExtensionContext["sessionManager"] };
	const internalModelCall = new AsyncLocalStorage<ModelOperation>();
	let activeModelOperation: ModelOperation | undefined;
	const agentDir = getAgentDir();
	type OperationGuard = { revision: number; lifecycle: LifecycleToken };
	function branchIds(ctx: ExtensionContext): string[] {
		const ids = ctx.sessionManager.getBranch().map((entry) => (entry as { id?: string }).id).filter((id): id is string => typeof id === "string");
		const leaf = ctx.sessionManager.getLeafId();
		return ids.length ? ids : leaf ? [leaf] : [];
	}
	function leafId(ctx: ExtensionContext): string { return ctx.sessionManager.getLeafId() ?? ""; }
	function latestAssistant(ctx: ExtensionContext): AssistantMessage | undefined {
		const entry = [...ctx.sessionManager.getBranch()].reverse().find((item) => item.type === "message" && isAssistantMessage(item.message as AgentMessage)) as { message: AssistantMessage } | undefined;
		return entry?.message;
	}
	function pendingWorkCheckpoint(ctx: ExtensionContext): string {
		// Step identity changes only on real milestone/pending-work changes, not
		// on prose, repeated plan updates or reload. Initial execution is one
		// stable checkpoint too; a second no-progress stop must wait.
		const prefix = `${state.executionId ?? state.planId}/${pendingSteps(state)[0]?.id}`;
		for (const entry of [...ctx.sessionManager.getBranch()].reverse()) {
			if (entry.type !== "message") continue;
			const message = entry.message as { role?: unknown; toolName?: unknown; toolCallId?: unknown };
			if (message.role !== "toolResult" || typeof message.toolName !== "string" || message.toolName === PLAN_UPDATE_TOOL || PLAN_EXECUTION_TOOLS.includes(message.toolName)) continue;
			const entryId = (entry as { id?: unknown }).id;
			const id = typeof message.toolCallId === "string" && message.toolCallId.length ? message.toolCallId : typeof entryId === "string" ? entryId : undefined;
			if (id) return `${prefix}/${message.toolName}:${id}`;
		}
		return `${prefix}/initial`;
	}
	function captureGuard(): OperationGuard { return { revision, lifecycle: lifecycle.capture() }; }
	function isCurrent(ctx: ExtensionContext, expected: number | OperationGuard): boolean {
		if (typeof expected === "number") return lifecycleGuard(expected, sessionId, revision, ctx.sessionManager.getSessionId());
		return expected.revision === revision && lifecycle.isCurrent(expected.lifecycle, ctx.sessionManager.getSessionId(), branchIds(ctx));
	}
	function serialize<T>(ctx: ExtensionContext, guard: OperationGuard, action: () => T): Promise<T> {
		return mutations.run(() => {
			if (!isCurrent(ctx, guard)) throw new Error("Plan operation was superseded by session navigation.");
			return action();
		}, "tool");
	}
	function isInternalModelEvent(ctx: ExtensionContext): boolean {
		const operation = internalModelCall.getStore();
		return operation !== undefined
			&& operation === activeModelOperation
			&& operation.sessionManager === ctx.sessionManager
			&& operation.sessionId === ctx.sessionManager.getSessionId();
	}
	function nativeDestinationModel(ctx: ExtensionContext): ModelSnapshot | undefined {
		const branch = ctx.sessionManager.getBranch();
		const selected = [...branch].reverse().find((entry) => entry.type === "model_change") as { provider?: unknown; modelId?: unknown } | undefined;
		const thinking = [...branch].reverse().find((entry) => entry.type === "thinking_level_change") as { thinkingLevel?: unknown } | undefined;
		const fallback = snapshotModel(ctx);
		const candidate = typeof selected?.provider === "string" && typeof selected.modelId === "string" && typeof thinking?.thinkingLevel === "string"
			? { provider: selected.provider, model: selected.modelId, thinkingLevel: thinking.thinkingLevel }
			: fallback;
		return isModelSnapshot(candidate) ? candidate : fallback;
	}
	function queueSessionModel(ctx: ExtensionContext, model: ModelSnapshot, guard = captureGuard()): Promise<boolean> {
		const intent = ++modelIntent;
		const effect = modelEffects.then(async () => {
			if (intent !== modelIntent || !isCurrent(ctx, guard)) return false;
			const current = snapshotModel(ctx);
			if (current?.provider === model.provider && current.model === model.model && current.thinkingLevel === model.thinkingLevel) return true;
			const operation: ModelOperation = { sessionId: ctx.sessionManager.getSessionId(), sessionManager: ctx.sessionManager };
			activeModelOperation = operation;
			try {
				return await internalModelCall.run(operation, () => setSessionModel(
					pi,
					ctx,
					model,
					() => intent === modelIntent && isCurrent(ctx, guard),
					(call) => internalModelCall.run(operation, call),
				));
			} finally {
				if (activeModelOperation === operation) activeModelOperation = undefined;
			}
		});
		modelEffects = effect.then(() => undefined, () => undefined);
		return effect;
	}
	function queueDestinationModel(ctx: ExtensionContext, planModel: ModelSnapshot | undefined, guard = captureGuard()): Promise<boolean> {
		const destination = planModel ?? nativeDestinationModel(ctx);
		return destination ? queueSessionModel(ctx, destination, guard) : Promise.resolve(isCurrent(ctx, guard));
	}
	function idle(ctx: ExtensionContext): boolean {
		if (ctx.isIdle()) return true;
		ctx.ui.notify("Wait for the active turn before changing the plan.", "warning");
		return false;
	}
	function owned(ctx: ExtensionContext): boolean {
		if (state.ownershipAttention) { ctx.ui.notify("Execution ownership needs source-session recovery; this session is inspection-only.", "warning"); return false; }
		if (state.phase !== "handed-off") return true;
		ctx.ui.notify("This plan belongs to its handed-off execution session.", "warning");
		return false;
	}
	const processStartedAt = processStartToken();

	function availableTools(): string[] { return pi.getAllTools().map((tool) => tool.name); }
	function syncLivePlan(): void {
		if (!sessionId || !sessionCwd) return;
		publishLivePlan({ pid: process.pid, sessionId, sessionFile, cwd: sessionCwd, processStartedAt }, state);
	}
	function persist(): void {
		revision++;
		pi.appendEntry("plan-mode", clonePlanState(state));
		if (state.steps.length && sessionId) writePlanFile(agentDir, sessionId, state.steps.map((step) => ({ ...step })));
		syncLivePlan();
	}
	function setTools(names: string[]): void { pi.setActiveTools([...new Set(names)].filter((name) => availableTools().includes(name))); }
	function applyRestrictedTools(): void { setTools(restrictedTools(state.accessMode, state.toolsBeforePlan ?? pi.getActiveTools(), availableTools())); }
	function executionTools(): void { setTools([...(state.toolsBeforePlan ?? pi.getActiveTools()), ...PLAN_EXECUTION_TOOLS]); }
	function restoreTools(clearSnapshot = false): void {
		if (state.toolsBeforePlan) setTools(state.toolsBeforePlan);
		else setTools(pi.getActiveTools().filter((name) => !PLAN_EXECUTION_TOOLS.includes(name)));
		if (clearSnapshot) state = { ...state, toolsBeforePlan: undefined };
	}
	function planContext(): string {
		return `Goal: ${state.goal}\n\nSteps:\n${formatSteps(state.steps)}${state.criteria.length ? `\n\nVerification criteria:\n${state.criteria.map((item) => `- ${item}`).join("\n")}` : ""}${state.followUps.length ? `\n\nKnown follow-up work:\n${state.followUps.map((item) => `- ${item}`).join("\n")}` : ""}`;
	}
	function refreshCompletedHistory(ctx: ExtensionContext): void {
		if (!project) return;
		const records = listCompletedPlansForSession(agentDir, project, sessionId);
		completedPlanCount = records.length;
		// A detached child finishes the same plan in another process. Once its
		// archive arrives, release this source session for its next sequential plan.
		if (state.phase === "handed-off" && state.planId && records.some((record) => record.id === state.planId)) {
			state = createPlanState();
			if (sessionId) deletePlanFile(agentDir, sessionId);
			persist();
		}
		updateUi(ctx);
	}
	function watchProjectHistory(ctx: ExtensionContext): void {
		closeHistoryWatcher?.();
		project = resolvePlanProject(ctx.cwd);
		const token = lifecycle.capture();
		const current = () => lifecycle.isCurrent(token, ctx.sessionManager.getSessionId(), branchIds(ctx));
		const watcher = watchCompletedPlans(agentDir, project, () => {
			if (!current()) return;
			if (historyRefreshTimer) clearTimeout(historyRefreshTimer);
			historyRefreshTimer = setTimeout(() => { if (current()) refreshCompletedHistory(ctx); }, 50);
		});
		closeHistoryWatcher = () => watcher.close();
		refreshCompletedHistory(ctx);
	}
	function updateUi(ctx: ExtensionContext): void {
		const status = planFooterStatus(state, completedPlanCount);
		const tone = state.phase === "executing" ? "accent" : !state.steps.length && state.accessMode === "none" && completedPlanCount ? "success" : status === "waiting to plan" ? "dim" : "warning";
		ctx.ui.setStatus("plan-mode", ctx.ui.theme.fg(tone, status));
		if (state.phase !== "executing" || !state.steps.length) return ctx.ui.setWidget("plan-todos", undefined);
		const done = state.steps.filter(isStepDone).length;
		if (state.continuation.waitFor && !canClosePlan(state)) {
			return ctx.ui.setWidget("plan-todos", [ctx.ui.theme.fg("warning", `plan ${done}/${state.steps.length} — waiting: ${state.continuation.waitFor.reason}`)]);
		}
		if (state.closeoutState.kind === "attention" && canClosePlan(state)) {
			return ctx.ui.setWidget("plan-todos", [ctx.ui.theme.fg("warning", `plan ${done}/${state.steps.length} — closeout needs attention; /plan-review to retry`)]);
		}
		if (state.widgetCollapsed) {
			const next = pendingSteps(state)[0];
			return ctx.ui.setWidget("plan-todos", [next ? `${ctx.ui.theme.fg("accent", `plan ${done}/${state.steps.length}`)} ${ctx.ui.theme.fg("muted", "—")} ${next.text}` : `${ctx.ui.theme.fg("accent", `plan ${done}/${state.steps.length}`)} ${ctx.ui.theme.fg("muted", "— finalizing closeout")}`]);
		}
		ctx.ui.setWidget("plan-todos", state.steps.map((step) => step.completed ? ctx.ui.theme.fg("success", "[x] ") + ctx.ui.theme.fg("muted", ctx.ui.theme.strikethrough(step.text)) : step.skipped ? ctx.ui.theme.fg("dim", "[-] ") + ctx.ui.theme.fg("dim", ctx.ui.theme.strikethrough(step.text)) : `${ctx.ui.theme.fg("muted", "[ ] ")}${step.text}`));
	}
	function showPlan(ctx: ExtensionContext): void {
		pi.sendMessage({ customType: "plan-todo-list", content: `## Current plan\n\n${planContext()}`, display: true }, { triggerTurn: false });
		updateUi(ctx);
	}
	function enterPlan(ctx: ExtensionContext): void {
		state = transitionPlanLifecycle(state, { type: "enter", mode: "plan", activeTools: pi.getActiveTools(), planningModel: snapshotModel(ctx) });
		applyRestrictedTools(); persist(); updateUi(ctx);
	}
	function enterReadOnly(ctx: ExtensionContext): void {
		state = transitionPlanLifecycle(state, { type: "enter", mode: "read-only", activeTools: pi.getActiveTools() });
		applyRestrictedTools(); persist(); updateUi(ctx);
	}
	async function restorePlanningModel(ctx: ExtensionContext, guard = captureGuard()): Promise<boolean> {
		if (state.planningModel && !(await queueSessionModel(ctx, state.planningModel, guard))) return false;
		return isCurrent(ctx, guard);
	}
	function branchPlanState(ctx: ExtensionContext): PlanState | undefined {
		const entry = [...ctx.sessionManager.getBranch()].reverse().find((item) => item.type === "custom" && item.customType === "plan-mode") as { data?: unknown } | undefined;
		const restored = migratePlanState(entry?.data);
		if (restored || !entry?.data || typeof entry.data !== "object") return restored;
		// Never fall through to a checklist sidecar after malformed persisted plan
		// data; that could drop an ownership fence and make an uncontrolled executor.
		return { ...createPlanState(), phase: "paused", ownershipAttention: { reason: "malformed-state" } };
	}
	function branchInternalPlan(ctx: ExtensionContext): InternalPlan | undefined {
		return latestInternalPlan(ctx.sessionManager.getBranch().flatMap((entry) => entry.type === "message" && entry.message.role === "toolResult" && entry.message.toolName === PLAN_UPDATE_TOOL ? [entry.message.details] : []));
	}
	function branchExecutionTransfer(ctx: ExtensionContext): CurrentPaneTransfer | undefined {
		// Transfer is bootstrap-only. Once this replacement branch has persisted a
		// valid plan state, that newer state owns restoration on reload/navigation.
		const branch = ctx.sessionManager.getBranch();
		const index = branch.map((item, i) => item.type === "custom" && item.customType === "plan-mode-new-session-execution" ? i : -1).filter((i) => i >= 0).at(-1);
		if (index === undefined || branch.slice(index + 1).some((item) => item.type === "custom" && item.customType === "plan-mode")) return undefined;
		// SAFETY: custom entries are local extension data; validate every field before use.
		const entry = branch[index] as { data?: unknown } | undefined;
		const value = entry?.data;
		if (!value || typeof value !== "object" || !("handoffPath" in value) || !("transferId" in value) || !("planId" in value) || !("saveDefault" in value) || !("source" in value)) return undefined;
		const transfer = value as CurrentPaneTransfer;
		return typeof transfer.handoffPath === "string" && typeof transfer.transferId === "string" && typeof transfer.planId === "string" && typeof transfer.saveDefault === "boolean" && !!transfer.source && typeof transfer.source.sessionId === "string" && typeof transfer.source.cwd === "string" && typeof transfer.source.tmuxSession === "string" ? transfer : undefined;
	}
	function restoreActiveHandoff(): void {
		const claim = state.executionClaim;
		activeHandoff = claim && validateExecutionClaim(agentDir, claim, { planId: state.planId, sourceSessionId: state.executionSource?.sessionId }) ? { path: claim.path, claimToken: claim.token } : undefined;
		if (claim && !activeHandoff) state = { ...state, phase: "paused", accessMode: "none", ownershipAttention: { reason: "invalid-claim" } };
	}
	async function activateRestoredState(ctx: ExtensionContext, restored: PlanState, guard = captureGuard(), restoreNative = false): Promise<boolean> {
		state = materializePlan(restored);
		restoreActiveHandoff();
		const activation = restorePlanLifecycle(state, state, pi.getActiveTools(), availableTools());
		state = activation.state;
		setTools(activation.tools);
		if (!activation.model && !restoreNative) return isCurrent(ctx, guard);
		return queueDestinationModel(ctx, activation.model, guard);
	}
	async function leaveReadOnly(ctx: ExtensionContext): Promise<void> {
		const transition = leaveRestrictedMode(state);
		state = transition.state;
		if (transition.restoreTools) setTools(transition.restoreTools);
		persist(); updateUi(ctx);
	}
	async function pause(ctx: ExtensionContext): Promise<void> {
		if (!owned(ctx) || (!state.steps.length && state.phase === "idle")) return;
		const guard = captureGuard();
		state = transitionPlanLifecycle(state, { type: "pause" });
		restoreTools();
		if (!(await restorePlanningModel(ctx, guard))) return;
		persist(); updateUi(ctx);
	}

	function executionCandidates(ctx: ExtensionContext, current: ModelSnapshot | undefined, saved: ModelSnapshot | undefined): ModelCandidate[] {
		const raw = ctx.scopedModels.length
			? ctx.scopedModels.flatMap((item) => (item.thinkingLevel ? [item.thinkingLevel] : getSupportedThinkingLevels(item.model).map(String)).map((thinkingLevel) => ({ provider: item.model.provider, model: item.model.id, thinkingLevel: thinkingLevel as ThinkingLevel })))
			: ctx.modelRegistry.getAvailable().flatMap((model) => getSupportedThinkingLevels(model).map(String).map((thinkingLevel) => ({ provider: model.provider, model: model.id, thinkingLevel: thinkingLevel as ThinkingLevel })));
		for (const snapshot of [current, saved]) {
			const model = snapshot && ctx.modelRegistry.find(snapshot.provider, snapshot.model);
			if (snapshot && model && getSupportedThinkingLevels(model).map(String).includes(snapshot.thinkingLevel)) raw.push({ provider: snapshot.provider, model: snapshot.model, thinkingLevel: snapshot.thinkingLevel });
		}
		const grouped = new Map<string, ModelCandidate>();
		for (const item of raw) {
			const key = `${item.provider}\u0000${item.model}`;
			const candidate = grouped.get(key) ?? { provider: item.provider, model: item.model, thinkingLevels: [] };
			if (!candidate.thinkingLevels.includes(item.thinkingLevel)) candidate.thinkingLevels.push(item.thinkingLevel);
			grouped.set(key, candidate);
		}
		return [...grouped.values()];
	}
	async function resolveTmuxTarget(): Promise<TmuxTarget | undefined> {
		if (!process.env.TMUX || !process.env.TMUX_PANE) return undefined;
		try {
			const result = await pi.exec("tmux", ["display-message", "-p", "-t", process.env.TMUX_PANE, "#{session_name}\t#{window_id}\t#{pane_id}"], { timeout: 3_000 });
			const [session, window, pane] = result.stdout.trim().split("\t");
			return result.code === 0 && session && window && pane ? { session, window, pane } : undefined;
		} catch { return undefined; }
	}
	async function executionSettings(ctx: ExtensionContext, tmux: TmuxTarget | undefined): Promise<ExecutionSettings | undefined> {
		if (ctx.mode !== "tui") { ctx.ui.notify("Execution settings require TUI mode.", "warning"); return undefined; }
		const current = snapshotModel(ctx);
		const savedState = inspectSavedExecutionModel(agentDir);
		const saved = savedState.status === "valid" ? savedState.executionModel : undefined;
		const candidates = executionCandidates(ctx, current, saved);
		const savedAvailable = Boolean(saved && candidateFor(candidates, saved.provider, saved.model)?.thinkingLevels.includes(saved.thinkingLevel));
		let settings = createExecutionSettings(current, defaultExecutionDestination(Boolean(tmux)), savedAvailable ? "saved" : "current");
		return ctx.ui.custom<ExecutionSettings | undefined>((tui, theme, keybindings, done) => {
			const destinations: { value: ExecutionDestination; label: string }[] = [
				{ value: "current", label: "Current Pi session" },
				{ value: "clipboard", label: "Copy plan to clipboard" },
				...(tmux ? [{ value: "tmux-current" as const, label: "New Pi session in current pane" }, { value: "tmux-pane" as const, label: "Detached pane in current tmux window" }, { value: "tmux-window" as const, label: "Detached window in current tmux session" }] : []),
			];
			let list: SettingsList;
			let selectedId = "destination";
			const refresh = () => {
				const rows = items();
				selectedId = retainSelectedExecutionRow(rows.map((row) => row.id), selectedId);
				const next = new SettingsList(rows, 10, getSettingsListTheme(), change, () => done(undefined));
				// SAFETY: SettingsList stores selectedIndex internally; retain its valid row index across rebuilds.
				(next as unknown as { selectedIndex: number }).selectedIndex = Math.max(0, rows.findIndex((row) => row.id === selectedId));
				list = next;
				tui.requestRender();
			};
			const item = (id: string, label: string, currentValue: string, values: string[], description?: string): SettingItem => ({ id, label, currentValue, values, description });
			const savedModelDescription = (state: SavedExecutionModelState): string => {
				if (state.status === "missing") return "No saved plan default. Using the current session model.";
				if (state.status === "invalid") return "The saved plan default is malformed. Using the current session model.";
				const label = `${state.executionModel.provider} / ${state.executionModel.model} / ${state.executionModel.thinkingLevel}`;
				return savedAvailable ? `Saved plan default: ${label}` : `Saved plan default is unavailable: ${label}. Using the current session model.`;
			};
			const items = (): SettingItem[] => {
				const destination = destinations.find((value) => value.value === settings.destination) ?? destinations[0]!;
				const rows: SettingItem[] = [item("destination", "Destination", destination.label, destinations.map((value) => value.label))];
				if (settings.destination !== "clipboard") {
					const policies = ["Current session model", ...(savedAvailable ? ["Saved plan default"] : []), "Choose model"];
					rows.push(item("policy", "Model policy", settings.modelPolicy === "current" ? "Current session model" : settings.modelPolicy === "saved" ? "Saved plan default" : "Choose model", policies, savedModelDescription(savedState)));
				}
				if (settings.destination === "tmux-pane") rows.push(item("direction", "Pane placement", settings.paneDirection === "right" ? "Right" : "Below", ["Below", "Right"]));
				if (settings.destination !== "clipboard" && settings.modelPolicy === "choose") {
					const providers = [...new Set(candidates.map((candidate) => candidate.provider))];
					const provider = providers.includes(settings.provider ?? "") ? settings.provider! : providers[0] ?? "(none)";
					const models = candidates.filter((candidate) => candidate.provider === provider);
					const model = models.some((candidate) => candidate.model === settings.model) ? settings.model! : models[0]?.model ?? "(none)";
					const candidate = candidateFor(candidates, provider, model);
					const thinking = candidate?.thinkingLevels.includes(settings.thinkingLevel as ThinkingLevel) ? settings.thinkingLevel! : candidate?.thinkingLevels[0] ?? "(none)";
					settings = { ...settings, provider, model, thinkingLevel: thinking === "(none)" ? undefined : thinking as ThinkingLevel };
					rows.push(item("provider", "Provider", provider, providers), item("model", "Model", model, models.map((candidate) => candidate.model)), item("thinking", "Thinking", thinking, candidate?.thinkingLevels ?? []), item("save", "Save as plan default", settings.saveDefault ? "Yes" : "No", ["No", "Yes"]));
				}
				rows.push(item("execute", "Action", "Execute", ["Execute"], "Starts only after this screen validates."), item("cancel", "Action", "Cancel", ["Cancel"], "Leaves the ready plan unchanged."));
				return rows;
			};
			const change = (id: string, value: string) => {
				selectedId = id;
				if (id === "execute") return done(settings);
				if (id === "cancel") return done(undefined);
				if (id === "destination") settings = { ...settings, destination: destinations.find((item) => item.label === value)?.value ?? settings.destination };
				else if (id === "policy") settings = { ...settings, modelPolicy: value === "Current session model" ? "current" : value === "Saved plan default" ? "saved" : "choose" };
				else if (id === "direction") settings = { ...settings, paneDirection: value === "Right" ? "right" : "below" };
				else if (id === "provider") settings = { ...settings, provider: value, model: undefined, thinkingLevel: undefined };
				else if (id === "model") settings = { ...settings, model: value, thinkingLevel: undefined };
				else if (id === "thinking") settings = { ...settings, thinkingLevel: value as ThinkingLevel };
				else if (id === "save") settings = { ...settings, saveDefault: value === "Yes" };
				refresh();
			};
			const selectedRow = (): SettingItem | undefined => items().find((row) => row.id === selectedId);
			const moveSelection = (direction: 1 | -1) => {
				const rows = items();
				const index = rows.findIndex((row) => row.id === selectedId);
				selectedId = rows[(index < 0 ? 0 : index + direction + rows.length) % rows.length]?.id ?? selectedId;
				refresh();
			};
			const cycleSelectedValue = (direction: 1 | -1) => {
				const row = selectedRow();
				if (!row?.values || row.values.length < 2) return;
				change(row.id, cycleExecutionSettingValue(row.values, row.currentValue, direction));
			};
			const container = new Container();
			container.addChild({ render: (width: number) => renderExecutionSettingsHeader(theme, width, truncateToWidth), invalidate() {} });
			refresh();
			container.addChild({ render: (width: number) => list.render(width), invalidate: () => list.invalidate(), handleInput: (data: string) => list.handleInput(data) });
			return {
				render: (width) => container.render(width),
				invalidate: () => container.invalidate(),
				handleInput: (data) => {
					if (keybindings.matches(data, "tui.select.cancel")) return done(undefined);
					if (keybindings.matches(data, "tui.select.up")) return moveSelection(-1);
					if (keybindings.matches(data, "tui.select.down")) return moveSelection(1);
					if (matchesKey(data, "shift+tab") || matchesKey(data, Key.left)) return cycleSelectedValue(-1);
					if (matchesKey(data, Key.tab) || matchesKey(data, Key.right)) return cycleSelectedValue(1);
					list.handleInput(data);
					tui.requestRender();
				},
			};
		});
	}
	async function beginExecution(ctx: ExtensionContext, model: ModelSnapshot, source?: { sessionId: string; cwd: string; tmuxSession?: string }, guard = captureGuard(), resetContinuation = true): Promise<boolean> {
		if (!state.steps.length || !isModelSnapshot(model)) return false;
		const resolved = ctx.modelRegistry.find(model.provider, model.model);
		if (!resolved) { ctx.ui.notify(`Execution model ${model.provider}/${model.model} is unavailable.`, "warning"); return false; }
		const planningModel = state.planningModel ?? snapshotModel(ctx);
		if (!(await queueSessionModel(ctx, model, guard))) { ctx.ui.notify(`Execution model ${model.provider}/${model.model} is unavailable or unauthenticated.`, "warning"); return false; }
		if (!isCurrent(ctx, guard)) return false;
		const executionSource = source ?? { sessionId, cwd: ctx.cwd };
		state = transitionPlanLifecycle(state, { type: "execute", model, source: executionSource, executionId: randomUUID(), planningModel, resetContinuation });
		executionTools(); persist(); showPlan(ctx);
		// No asynchronous seam follows this commit; its own persist advances revision.
		pi.sendMessage({ customType: "plan-execution-kickoff", content: renderExecutionContext(state, executionSource), display: true }, { triggerTurn: true, deliverAs: "followUp" });
		return true;
	}
	async function replaceWithExecutionSession(ctx: ExtensionCommandContext, transfer: CurrentPaneTransfer): Promise<"started" | "ready" | "claimed"> {
		const parentSession = ctx.sessionManager.getSessionFile();
		const result = await ctx.newSession({
			parentSession,
			setup: async (manager) => { manager.appendCustomEntry("plan-mode-new-session-execution", transfer); },
			withSession: async (replacement) => { await replacement.sendUserMessage("/plan-review", { expandPromptTemplates: true }); },
		});
		return result.cancelled ? (cancelUnclaimedExecutionPacket(agentDir, transfer.handoffPath) ? "ready" : "claimed") : "started";
	}
	async function executeWizard(ctx: ExtensionContext): Promise<void> {
		const guard = captureGuard();
		const tmux = await resolveTmuxTarget();
		const settings = await executionSettings(ctx, tmux);
		if (!settings || !isCurrent(ctx, guard)) return;
		const resolution = resolveExecutionSettings(settings, snapshotModel(ctx), loadPlanModeConfig(agentDir).executionModel, executionCandidates(ctx, snapshotModel(ctx), loadPlanModeConfig(agentDir).executionModel));
		if (resolution.ok === false) return ctx.ui.notify(resolution.error, "warning");
		if (resolution.value.destination === "clipboard") { await copyToClipboard(renderPlanMarkdown(state)); ctx.ui.notify("Plan copied to the clipboard.", "info"); return; }
		const model = resolution.value.model!;
		if (resolution.value.destination === "current") { if (await beginExecution(ctx, model, undefined, guard) && resolution.value.saveDefault && lifecycle.isCurrent(guard.lifecycle, ctx.sessionManager.getSessionId(), branchIds(ctx))) savePlanModeConfig(model, agentDir); return; }
		if (!tmux) return;
		const source = { sessionId, cwd: ctx.cwd, tmuxSession: tmux.session };
		if (resolution.value.destination === "tmux-current") {
			const executionPlan = materializePlan({ ...state, phase: "executing", accessMode: "none", executionModel: model, executionSource: source });
			const handoffPath = writeExecutionPacket(agentDir, { version: 2, plan: executionPlan, source, model });
			// Persist an exact transfer record before queueing the replacement command.
			const transfer: CurrentPaneTransfer = { handoffPath, transferId: randomUUID(), saveDefault: resolution.value.saveDefault, source, planId: executionPlan.planId! };
			state = { ...executionPlan, phase: "handed-off", handoffPath, currentPaneTransfer: transfer, accessMode: "none", awaitingReview: false };
			persist();
			pi.sendUserMessage("/plan-review", { expandPromptTemplates: true });
			return;
		}
		const destination = resolution.value.destination;
		const executionPlan = materializePlan({ ...state, phase: "executing", accessMode: "none", executionModel: model, executionSource: source });
		const packetPath = writeExecutionPacket(agentDir, { version: 2, plan: executionPlan, source, model });
		const intent: DetachedHandoffIntent = {
			handoffPath: packetPath, transferId: randomUUID(), planId: executionPlan.planId!, source, sourceLeafId: leafId(ctx), destination,
			launch: { cwd: ctx.cwd, session: tmux.session, window: tmux.window, pane: tmux.pane, paneDirection: destination === "tmux-pane" ? resolution.value.paneDirection : undefined },
		};
		// The durable source fence exists before tmux is invoked. Cancellation, timeout,
		// navigation, reload, and shutdown therefore cannot revive this source as ready.
		state = { ...executionPlan, phase: "handed-off", handoffPath: packetPath, detachedHandoff: intent, accessMode: "none", awaitingReview: false };
		persist();
		const launchGuard = captureGuard();
		const args = destination === "tmux-pane" ? buildTmuxDetachedPaneArgs(tmux, ctx.cwd, packetPath, model, resolution.value.paneDirection) : buildTmuxNewWindowArgs(tmux, ctx.cwd, packetPath, model);
		try {
			const launch = await pi.exec("tmux", args, { timeout: 5_000 });
			if (launch.code !== 0) throw new Error(launch.stderr.trim() || "tmux failed");
		} catch (error) {
			return ctx.ui.notify(`Could not launch tmux handoff; source ownership remains fenced: ${error instanceof Error ? error.message : "tmux failed"}`, "warning");
		}
		if (!isCurrent(ctx, launchGuard)) return;
		const acknowledgement = await waitForExecutionAcknowledgement(agentDir, packetPath);
		if (!isCurrent(ctx, launchGuard) || state.phase !== "handed-off" || state.handoffPath !== packetPath) return;
		if (resolution.value.saveDefault) savePlanModeConfig(model, agentDir);
		restoreTools(true);
		if (!(await restorePlanningModel(ctx, launchGuard))) return;
		persist(); refreshCompletedHistory(ctx);
		if (acknowledgement === "ready") ctx.ui.notify("Tmux handoff is ready in the new execution session.", "info");
		else if (acknowledgement === "claimed") ctx.ui.notify("Tmux handoff claimed the plan but did not confirm readiness; execution ownership remains with the new session.", "warning");
		else ctx.ui.notify("Tmux handoff is still unclaimed; use /plan-review in this exact source branch to cancel it or retry deliberately.", "warning");
	}
	async function requestRevision(ctx: ExtensionContext, request?: string): Promise<void> {
		const guard = captureGuard();
		const draft = request ? { text: request, images: [] } : await promptForRecalibration(ctx, agentDir);
		if (!draft?.text.trim() || !isCurrent(ctx, guard)) return;
		state = transitionPlanLifecycle(state, { type: "revise" });
		applyRestrictedTools();
		if (!(await restorePlanningModel(ctx, guard))) return;
		persist(); updateUi(ctx);
		if (!isCurrent(ctx, guard)) return;
		pi.sendUserMessage(buildRecalibrationMessage(renderExecutionContext(state, state.executionSource ?? { sessionId, cwd: ctx.cwd }, "recalibration"), draft), { deliverAs: "followUp" });
	}
	function restoreInterruptedCloseout(): boolean {
		if (state.phase !== "executing" || (state.closeoutState.kind !== "requested" && state.closeoutState.kind !== "started")) return false;
		state = transitionPlanLifecycle(state, { type: "closeout", state: { ...state.closeoutState, kind: "attention", reason: "restored" } });
		return true;
	}
	function closePlan(ctx: ExtensionContext, closeout: PlanCloseout): void {
		if (state.continuation.waitFor) throw new Error("Clear the legitimate executionWait with a tracked update before plan_complete.");
		const source = state.executionSource ?? { sessionId, cwd: ctx.cwd };
		// Archive before changing tools or state so an I/O failure leaves this plan
		// executable and lets plan_complete be retried safely.
		try {
			archiveCompletedPlan(agentDir, completedPlanRecord(state, source.sessionId, resolvePlanProject(source.cwd), closeout));
		} catch (error) {
			state = transitionPlanLifecycle(state, { type: "closeout", state: state.planId ? { kind: "attention", planId: state.planId, terminalEpoch: state.terminalEpoch, executionId: closeoutExecutionIdentity(state), reason: "archive-failed" } : { kind: "idle" } });
			persist(); updateUi(ctx);
			throw error;
		}
		if (activeHandoff) { deleteExecutionPacket(agentDir, activeHandoff.path, activeHandoff.claimToken); activeHandoff = undefined; }
		state = { ...state, executionClaim: undefined };
		pi.sendMessage({ customType: "plan-complete", content: `## Plan complete\n\n**Goal:** ${state.goal}\n\n**Outcome:** ${closeout.outcome}\n\n**End state:** ${closeout.endState}\n\n**Verification:**\n${closeout.verification.map((item) => `- ${item}`).join("\n")}\n\n**Deviations:**\n${(closeout.deviations.length ? closeout.deviations : ["None."]).map((item) => `- ${item}`).join("\n")}\n\n**Next steps:**\n${(closeout.nextSteps.length ? closeout.nextSteps : state.followUps.length ? state.followUps : ["No further work identified."]).map((item) => `- ${item}`).join("\n")}`, display: true }, { triggerTurn: false });
		restoreTools();
		// Successful execution remains on its selected model. Pause, recalibration,
		// shutdown, and detached-source cleanup still restore the planning model.
		state = createPlanState();
		if (sessionId) deletePlanFile(agentDir, sessionId);
		persist(); refreshCompletedHistory(ctx);
	}
	async function editPlanSteps(ctx: ExtensionContext): Promise<void> {
		const expected = captureGuard();
		const text = await ctx.ui.editor("Edit top-level plan steps (keep [id] to preserve status):", state.steps.map((step) => `[${step.id}] ${step.text}`).join("\n"));
		const steps = text ? parsePlanEditEntries(text) : [];
		if (!steps.length || !isCurrent(ctx, expected)) return;
		const retained = new Set(steps.flatMap((step) => step.id ? [step.id] : []));
		const resetTerminal = state.steps.filter((step) => isStepDone(step) && !retained.has(step.id));
		if (resetTerminal.length && !(await ctx.ui.confirm("Remove completed or skipped steps?", `These terminal steps will be removed/reset:\n${resetTerminal.map((step) => `- ${step.text} (${step.id})`).join("\n")}\n\nContinue?`))) return;
		if (!isCurrent(ctx, expected)) return;
		state = applyPlanUpdate(state, { goal: state.goal, steps, criteria: state.criteria, followUps: state.followUps, executionBrief: state.executionBrief });
		persist(); showPlan(ctx);
	}
	function isExactDetachedSource(ctx: ExtensionContext, intent: DetachedHandoffIntent): boolean {
		return sessionId === intent.source.sessionId && branchIds(ctx).includes(intent.sourceLeafId);
	}
	async function reviewPlan(ctx: ExtensionCommandContext): Promise<void> {
		if (state.ownershipAttention) {
			ctx.ui.notify(state.ownershipAttention.reason === "malformed-state" ? "The restored tracked plan is malformed and has been refused; inspect the source session before recovery." : "The child claim is no longer valid; only its source session may recover the handoff.", "warning");
			return;
		}
		// Current-pane transfer is source-owned until the replacement claims its exact packet.
		const replacementTransfer = branchExecutionTransfer(ctx);
		if (state.currentPaneTransfer && !replacementTransfer) {
			const transfer = state.currentPaneTransfer;
			try {
				const outcome = await replaceWithExecutionSession(ctx, transfer);
				if (outcome === "ready" && state.currentPaneTransfer?.transferId === transfer.transferId) {
					state = { ...state, phase: "ready", accessMode: "plan", handoffPath: undefined, currentPaneTransfer: undefined };
					persist(); applyRestrictedTools(); updateUi(ctx);
				} else if (outcome === "claimed") ctx.ui.notify("The replacement may have claimed the plan; ownership remains fenced.", "warning");
			} catch (error) {
				if (cancelUnclaimedExecutionPacket(agentDir, transfer.handoffPath) && state.currentPaneTransfer?.transferId === transfer.transferId) {
					state = { ...state, phase: "ready", accessMode: "plan", handoffPath: undefined, currentPaneTransfer: undefined };
					persist(); applyRestrictedTools(); updateUi(ctx);
				}
				ctx.ui.notify(`Could not create the execution session: ${error instanceof Error ? error.message : "session replacement failed"}`, "warning");
			}
			return;
		}
		if (state.detachedHandoff) {
			const intent = state.detachedHandoff;
			if (!isExactDetachedSource(ctx, intent)) { ctx.ui.notify("This detached handoff can only be controlled from its original source branch.", "warning"); return; }
			const owner = executionOwner(agentDir, intent.handoffPath);
			if (owner === "unknown") {
				const confirmed = await ctx.ui.confirm("Cancel unclaimed tmux handoff?", "This explicitly fences the packet and returns this source plan to ready state. You can then review and launch again.");
				if (!confirmed || !isExactDetachedSource(ctx, intent) || state.detachedHandoff?.transferId !== intent.transferId) return;
				if (!cancelUnclaimedExecutionPacket(agentDir, intent.handoffPath)) return ctx.ui.notify("The handoff changed; ownership remains fenced.", "warning");
				state = { ...state, phase: "ready", accessMode: "plan", handoffPath: undefined, detachedHandoff: undefined };
				applyRestrictedTools(); persist(); updateUi(ctx);
				return;
			}
			ctx.ui.notify(owner === "dead" ? "The detached execution is dead; use /plan-recover from this source branch." : "This plan is owned by its handed-off execution session.", "warning");
			return;
		}
		if (state.phase === "handed-off") { ctx.ui.notify("This plan is owned by its handed-off execution session.", "warning"); return; }
		if (activeHandoff && state.executionClaim && state.phase === "ready") {
			const model = state.executionModel;
			if (!model) return ctx.ui.notify("The claimed execution has no model; inspect it before recovery.", "warning");
			const started = await beginExecution(ctx, model, state.executionSource);
			if (started && !acknowledgeExecutionPacket(agentDir, activeHandoff.path, activeHandoff.claimToken)) ctx.ui.notify("Execution started, but handoff readiness could not be recorded.", "warning");
			return;
		}
		if (replacementTransfer) {
			const candidate = replacementTransfer;
			const packet = consumeExecutionPacket(agentDir, candidate.handoffPath);
			if (!packet || packet.plan.planId !== candidate.planId || packet.source.sessionId !== candidate.source.sessionId || packet.source.cwd !== candidate.source.cwd || packet.source.tmuxSession !== candidate.source.tmuxSession) return ctx.ui.notify("The new-session execution handoff is unavailable.", "warning");
			state = materializePlan({ ...packet.plan, version: 7, phase: "ready", accessMode: "none", awaitingReview: false, executionSource: packet.source, planningModel: undefined, toolsBeforePlan: pi.getActiveTools().filter((name) => !PLAN_EXECUTION_TOOLS.includes(name)), executionClaim: { path: candidate.handoffPath, token: packet.claimToken } });
			activeHandoff = { path: candidate.handoffPath, claimToken: packet.claimToken };
			persist();
			const started = await beginExecution(ctx, packet.model, packet.source);
			if (started && !acknowledgeExecutionPacket(agentDir, candidate.handoffPath, packet.claimToken)) ctx.ui.notify("Execution started, but handoff readiness could not be recorded.", "warning");
			if (started && candidate.saveDefault) savePlanModeConfig(packet.model, agentDir);
			if (!started) ctx.ui.notify("The execution session owns the handoff but could not set its model; use /plan-review to recover it.", "warning");
			return;
		}
		if (!state.steps.length) { enterPlan(ctx); return; }
		if (state.phase === "executing" && canClosePlan(state) && state.continuation.waitFor) {
			ctx.ui.notify("Clear the legitimate executionWait with a tracked update before retrying closeout.", "warning");
			return;
		}
		if (state.phase === "executing" && canClosePlan(state) && state.closeoutState.kind === "attention" && closeoutMatches(state)) {
			state = transitionPlanLifecycle(state, { type: "closeout", state: { kind: "requested", planId: state.planId!, terminalEpoch: state.terminalEpoch, executionId: closeoutExecutionIdentity(state) } });
			persist();
			pi.sendMessage({ customType: "plan-closeout-retry", content: "Retry closeout now: call plan_complete with the final outcome, end state, verification, deviations, and next steps.", display: true }, { triggerTurn: true, deliverAs: "followUp" });
			return;
		}
		const expected = captureGuard();
		const choice = await ctx.ui.select("Current plan",  ["Execute", "Recalibrate from current state", "Edit steps manually", "Pause plan", "Discard plan"]);
		if (!isCurrent(ctx, expected)) return;
		if (choice === "Execute") await executeWizard(ctx);
		else if (choice === "Recalibrate from current state") await requestRevision(ctx);
		else if (choice === "Edit steps manually") await editPlanSteps(ctx); else if (choice === "Pause plan") await pause(ctx);
		else if (choice === "Discard plan") { restoreTools(); state = createPlanState(); if (sessionId) deletePlanFile(agentDir, sessionId); persist(); updateUi(ctx); }
	}
	async function showTodos(ctx: ExtensionContext): Promise<void> {
		if (!state.steps.length) return;
		await ctx.ui.custom<void>((tui, theme, _kb, done) => {
			let index = 0;
			const refresh = () => tui.requestRender();
			return { render: (width) => renderPlanProgress(theme, state.steps, index, width, truncateToWidth), invalidate() {}, handleInput(data) { if (matchesKey(data, Key.escape) || matchesKey(data, "ctrl+c")) return done(); if (matchesKey(data, Key.up)) { index = (index - 1 + state.steps.length) % state.steps.length; refresh(); } else if (matchesKey(data, Key.down)) { index = (index + 1) % state.steps.length; refresh(); } else if (matchesKey(data, Key.space) || matchesKey(data, Key.enter)) { const step = state.steps[index]!; const action = !step.completed && !step.skipped ? "complete" : step.completed ? "skip" : "uncomplete"; state = updatePlanStep(state, step.step, action); persist(); updateUi(ctx); refresh(); } } };
		});
	}

	// The subagent runner requests the current access policy at dispatch time.
	pi.events.on("plan-mode:access-policy", (receive: unknown) => { if (typeof receive === "function") receive(state.accessMode); });
	pi.registerFlag("plan", { description: "Start in structured read-only plan mode", type: "boolean", default: false });
	function samePausedPlan(ctx: ExtensionContext, planId: string | undefined): boolean {
		return state.phase === "paused" && state.planId === planId && sessionId === ctx.sessionManager.getSessionId();
	}
	async function changeMode(ctx: ExtensionContext, target: "plan" | "read-only" | "none" | "cycle"): Promise<void> {
		if (!idle(ctx) || !owned(ctx)) return;
		const next = target === "cycle" ? state.phase === "executing" || state.accessMode === "none" ? "plan" : state.accessMode === "plan" ? "read-only" : "none" : target;
		if (state.phase === "executing") {
			const planId = state.planId;
			await pause(ctx);
			if (!samePausedPlan(ctx, planId)) return;
		}
		if (next === "plan") enterPlan(ctx);
		else if (next === "read-only") enterReadOnly(ctx);
		else await leaveReadOnly(ctx);
	}
	pi.registerCommand("plan", { description: "Enter structured planning or pause an active execution", handler: async (_args, ctx) => changeMode(ctx, "plan") });
	pi.registerCommand("read-only", { description: "Enter standalone read-only inspection mode", handler: async (_args, ctx) => changeMode(ctx, "read-only") });
	pi.registerCommand("mode", { description: "Cycle none, plan, and read-only access modes", handler: async (_args, ctx) => changeMode(ctx, "cycle") });
	pi.registerCommand("plan-review", { description: "Execute, recalibrate, pause, or discard the active plan", handler: async (_args, ctx) => { if (idle(ctx)) await reviewPlan(ctx); } });
	pi.registerCommand("plan-recover", { description: "Inspect and explicitly reclaim a dead detached execution", handler: async (_args, ctx) => {
		if (!idle(ctx)) return;
		if (state.detachedHandoff && !isExactDetachedSource(ctx, state.detachedHandoff)) return ctx.ui.notify("Detached recovery is allowed only from its original source branch.", "warning");
		const persistedRecovery = state.phase === "paused" ? state.recovery : undefined;
		const handoffPath = state.phase === "handed-off" ? state.handoffPath : persistedRecovery?.handoffPath;
		const planId = state.planId;
		const sourceSessionId = state.executionSource?.sessionId;
		if (!handoffPath || !planId || !sourceSessionId || (persistedRecovery && (persistedRecovery.planId !== planId || persistedRecovery.sourceSessionId !== sourceSessionId))) return ctx.ui.notify("No recoverable detached handoff is recorded.", "warning");
		refreshCompletedHistory(ctx);
		if (state.phase === "paused" && persistedRecovery && recoveredExecutionPacketFinished(agentDir, handoffPath, persistedRecovery.token, planId, sourceSessionId)) {
			const expected = captureGuard();
			if (!(await ctx.ui.confirm("Reconcile finished recovery?", "The recovery cleanup completed before this session saved its final state. Keep the paused plan; this does not restart execution.")) || !isCurrent(ctx, expected) || state.recovery?.token !== persistedRecovery.token) return;
			state = { ...state, handoffPath: undefined, currentPaneTransfer: undefined, detachedHandoff: undefined, recovery: undefined };
			persist(); updateUi(ctx); return;
		}
		const owner = executionOwner(agentDir, handoffPath);
		if (owner !== "dead") return ctx.ui.notify(`Execution owner is ${owner}; ownership cannot be reclaimed.`, "warning");
		const expected = captureGuard();
		const confirmed = await ctx.ui.confirm("Reclaim dead execution?", "The execution process is gone, but it may have changed files before stopping. Inspect its work before restarting; recovery does not undo changes.");
		if (!confirmed || !isCurrent(ctx, expected) || !state.planId || state.planId !== planId || state.executionSource?.sessionId !== sourceSessionId || !((state.phase === "handed-off" && state.handoffPath === handoffPath) || (state.phase === "paused" && state.recovery?.handoffPath === handoffPath))) return;
		const recoveryToken = reclaimDeadExecutionPacket(agentDir, handoffPath);
		if (!recoveryToken) return ctx.ui.notify("The handoff changed or could not be reclaimed.", "warning");
		state = { ...state, phase: "paused", accessMode: "none", toolsBeforePlan: undefined, recovery: { handoffPath, token: recoveryToken, planId, sourceSessionId } };
		persist();
		if (!finishRecoveredExecutionPacket(agentDir, handoffPath, recoveryToken)) return ctx.ui.notify("Recovery ownership changed before cleanup; retry /plan-recover.", "warning");
		state = { ...state, handoffPath: undefined, currentPaneTransfer: undefined, detachedHandoff: undefined, recovery: undefined };
		persist(); updateUi(ctx);
	} });
	pi.registerCommand("plan-edit", { description: "Edit top-level steps in the active plan", handler: async (_args, ctx) => {
		if (!idle(ctx) || !owned(ctx)) return;
		if (!state.steps.length) return ctx.ui.notify("No active plan.", "info");
		await editPlanSteps(ctx);
	} });
	pi.registerCommand("plan-widget", { description: "Toggle collapsed plan progress", handler: async (_args, ctx) => { if (!owned(ctx)) return; state = { ...state, widgetCollapsed: !state.widgetCollapsed }; persist(); updateUi(ctx); } });
	pi.registerCommand("todos", { description: "View or correct plan progress", handler: async (_args, ctx) => { if (idle(ctx) && owned(ctx)) await showTodos(ctx); } });
	pi.registerCommand("pause", { description: "Pause plan execution", handler: async (_args, ctx) => { if (idle(ctx)) await pause(ctx); } });
	pi.registerShortcut(Key.ctrl("p"), { description: "Cycle none → plan → read-only → none", handler: async (ctx) => changeMode(ctx, "cycle") });
	pi.registerShortcut(Key.ctrlAlt("p"), { description: "Toggle collapsed plan progress", handler: async (ctx) => { state = { ...state, widgetCollapsed: !state.widgetCollapsed }; persist(); updateUi(ctx); } });
	pi.registerShortcut(Key.ctrlAlt("t"), { description: "Toggle collapsed plan progress", handler: async (ctx) => { state = { ...state, widgetCollapsed: !state.widgetCollapsed }; persist(); updateUi(ctx); } });

	pi.registerTool({ name: PLAN_UPDATE_TOOL, label: "Plan Update", description: "Create or revise an internal agent plan or the explicit tracked execution plan.", promptSnippet: "Create or revise an internal or tracked structured plan", promptGuidelines: ["Call plan_update after planning and when scope or blockers change pending work. Use tracked executionWait with a reason when waiting for input, a permission decision, an external dependency, or continuation budget; internal updates cannot change it. Use scope=internal for agent-only coordination; omit scope only in explicit plan mode or tracked execution when the tracked plan should change."], parameters: PlanUpdateParams, async execute(_id, params, _signal, _update, ctx) {
		const guard = captureGuard();
		const result = await serialize(ctx, guard, () => {
			const { scope: requestedScope, executionWait, ...payload } = params as typeof params & { executionWait?: ExecutionWait | null };
			const scope = resolvePlanUpdateScope(requestedScope, state.accessMode, state.phase);
			if (executionWait !== undefined && executionWait !== null && !isExecutionWait(executionWait)) throw new Error("executionWait requires a supported kind and nonblank reason.");
			if (scope === "internal") {
				if (executionWait !== undefined) throw new Error("executionWait is available only on tracked plan updates.");
				if (payload.steps.some((step) => typeof step !== "string")) throw new Error("Internal plans accept only string steps; step IDs are tracked-plan-only.");
				const action = internalPlan ? "replaced" : "created";
				internalPlan = createInternalPlan({ ...payload, steps: payload.steps as string[] });
				return { response: { content: [{ type: "text" as const, text: `Internal plan ${action} with ${internalPlan.steps.length} step(s).` }], details: { scope: "internal" as const, internalPlan } } };
			}
			if (!canUpdateTrackedPlan(state.accessMode, state.phase)) throw new Error("Tracked plan updates require explicit plan mode or active tracked execution.");
			state = materializePlan(applyPlanUpdate(state, payload as { goal: string; steps: TrackedPlanStepInput[]; criteria?: string[]; followUps?: string[]; executionBrief: PlanState["executionBrief"] }));
			if (executionWait !== undefined) state = { ...state, continuation: executionWait === null ? { ...state.continuation, waitFor: undefined } : { ...state.continuation, waitFor: { ...executionWait } } };
			const resumeModel = state.phase === "revising" && state.resumeAfterRevision ? state.executionModel ?? loadPlanModeConfig(agentDir).executionModel ?? snapshotModel(ctx) : undefined;
			persist(); updateUi(ctx);
			return { resumeModel, resumeGuard: captureGuard(), response: { content: [{ type: "text" as const, text: `Tracked plan updated with ${state.steps.length} step(s).\n${planContext()}` }], details: { scope: "tracked" as const, state: clonePlanState(state) } } };
		});
		if (result.resumeModel && !(await beginExecution(ctx, result.resumeModel, undefined, result.resumeGuard, false))) throw new Error("No valid execution model is available.");
		return result.response;
	} });
	pi.registerTool({ name: PLAN_STEP_TOOL, label: "Plan Step", description: "Track an approved plan step during execution.", promptSnippet: "Mark an executing plan step complete or skipped", promptGuidelines: ["Call plan_step immediately after each executed or skipped step."], parameters: PlanStepParams, async execute(_id, params, _signal, _update, ctx) { const guard = captureGuard(); return serialize(ctx, guard, () => { if (state.phase !== "executing") throw new Error("plan_step is available only while executing."); if (params.action === "list") return { content: [{ type: "text", text: formatSteps(state.steps) }], details: { state: clonePlanState(state) } }; if (params.step === undefined) throw new Error("plan_step requires a valid step."); state = updatePlanStep(state, params.step, params.action); const step = state.steps.find((item) => item.step === params.step)!; persist(); updateUi(ctx); return { content: [{ type: "text", text: `Step ${step.step} marked ${params.action}: ${step.text}` }], details: { state: clonePlanState(state) } }; }); } });
	pi.registerTool({ name: PLAN_COMPLETE_TOOL, label: "Plan Complete", description: "Record the final plan outcome.", promptSnippet: "Record the final plan outcome and next steps", promptGuidelines: ["Call plan_complete after every plan step is terminal."], parameters: PlanCompleteParams, async execute(_id, params, _signal, _update, ctx) { const guard = captureGuard(); return serialize(ctx, guard, () => { if (!canClosePlan(state)) throw new Error("plan_complete requires every plan step to be terminal."); const closeout: PlanCloseout = { goal: state.goal, ...params, deviations: params.deviations ?? [], nextSteps: params.nextSteps ?? [] }; closePlan(ctx, closeout); return { content: [{ type: "text", text: "Plan closeout recorded." }], details: { closeout } }; }); } });

	function queueLatestModelSnapshot(ctx: ExtensionContext): void {
		const desired = snapshotModel(ctx);
		if (desired && isModelSnapshot(desired)) void queueSessionModel(ctx, desired);
		else modelIntent++;
	}
	pi.on("model_select", async (event, ctx) => {
		const selected = (event as { model?: { provider?: unknown; id?: unknown } }).model;
		if (!selected || typeof selected.provider !== "string" || typeof selected.id !== "string") return;
		if (isInternalModelEvent(ctx)) return;
		// A manual selection is the newest destination. Capture it even when it chose
		// the same model that an authenticated internal mutation is still targeting.
		const desired = snapshotModel(ctx);
		if (desired?.provider === selected.provider && desired.model === selected.id) queueLatestModelSnapshot(ctx);
		else modelIntent++;
	});
	pi.on("thinking_level_select", async (event, ctx) => {
		if (isInternalModelEvent(ctx)) return;
		const selected = (event as { thinkingLevel?: unknown; level?: unknown }).thinkingLevel ?? (event as { level?: unknown }).level;
		const current = snapshotModel(ctx);
		if (typeof selected !== "string" || !current) return;
		const selectedModel = { ...current, thinkingLevel: selected as ThinkingLevel };
		if (!isModelSnapshot(selectedModel)) return;
		void queueSessionModel(ctx, selectedModel);
	});
	pi.on("tool_call", async (event) => { const reason = checkRestrictedToolCall(state.accessMode, event.toolName, event.input); return reason ? { block: true, reason } : undefined; });
	pi.on("context", async (event) => ({ messages: event.messages.filter((message) => { const type = (message as { customType?: string }).customType; if (!type || !CONTEXT_TYPES.has(type)) return true; return (type === "plan-mode-context" && state.accessMode === "plan") || (type === "read-only-mode-context" && state.accessMode === "read-only"); }) }));
	pi.on("before_agent_start", async (event) => {
		if (state.phase === "executing" && !state.continuation.waitFor && canClosePlan(state) && closeoutMatches(state) && state.closeoutState.kind === "requested") {
			closeoutAttempt = { planId: state.planId!, terminalEpoch: state.terminalEpoch, executionId: closeoutExecutionIdentity(state) };
			state = transitionPlanLifecycle(state, { type: "closeout", state: { ...closeoutAttempt, kind: "started" } });
			persist();
		}
		const guidance = restrictionGuidance(state.accessMode);
		if (guidance) return { systemPrompt: `${event.systemPrompt}\n\n${guidance}` };
		if (state.phase === "executing") return { systemPrompt: `${event.systemPrompt}\n\n${executionGuidance()}` };
	});
	pi.on("agent_before_settle", async (event, ctx) => {
		const completed = event.outcome === "completed" && assistantCompleted(latestAssistant(ctx));
		if (state.phase !== "executing" || state.continuation.waitFor) return;
		if (canClosePlan(state) && closeoutMatches(state) && state.closeoutState.kind === "requested") {
			// Closeout has its own epoch-bound attempt. Never spend or reset pending-work
			// rescue allowance here.
			if (!completed || event.continue || !event.context.canContinue || event.context.pendingMessages.length) {
				state = transitionPlanLifecycle(state, { type: "closeout", state: { kind: "attention", planId: state.planId!, terminalEpoch: state.terminalEpoch, executionId: closeoutExecutionIdentity(state), reason: "missing-complete" } });
				persist();
				return;
			}
			state = transitionPlanLifecycle(state, { type: "closeout", state: { kind: "started", planId: state.planId!, terminalEpoch: state.terminalEpoch, executionId: closeoutExecutionIdentity(state) } });
			persist();
			return { continue: true, entries: [{ type: "custom_message", customType: "plan-closeout-request", content: "All plan steps are terminal. Call plan_complete now with the final outcome, end state, verification, deviations, and next steps.", display: true }] };
		}
		const decision = decideExecutionContinuation(state.continuation, {
			checkpoint: pendingWorkCheckpoint(ctx),
			canContinue: event.context.canContinue,
			pendingMessages: event.context.pendingMessages.length > 0,
			alreadyContinuing: event.continue,
			completed,
			eligible: state.accessMode === "none" && !state.ownershipAttention && !state.detachedHandoff && !state.currentPaneTransfer && !canClosePlan(state),
		});
		if (decision.kind === "none") return;
		state = { ...state, continuation: decision.continuation };
		persist(); updateUi(ctx);
		if (decision.kind === "wait") return;
		return { continue: true, entries: [{ type: "custom_message", customType: "plan-pending-work-rescue", content: "Pending tracked work remains after an execution checkpoint. Continue the current approved plan; call plan_step after progress, retain ordinary-tool failure evidence, use plan_update with executionWait when waiting for input, permission, an external dependency, or budget, or call plan_complete only after every step is terminal.", display: true }] };
	});
	pi.on("agent_settled", async (_event, ctx) => {
		if (state.phase === "ready" && state.awaitingReview && state.accessMode === "plan") { state = { ...state, awaitingReview: false }; persist(); showPlan(ctx); const expected = captureGuard(); const choice = await ctx.ui.select("Plan ready", ["Execute", "Recalibrate plan", "Stay in plan mode"]); if (!isCurrent(ctx, expected)) return; if (choice === "Execute") await executeWizard(ctx); else if (choice === "Recalibrate plan") await requestRevision(ctx); return; }
		if (state.phase !== "executing") return;
		if (canClosePlan(state) && closeoutMatches(state) && (state.closeoutState.kind === "started" || (state.closeoutState.kind === "requested" && closeoutAttempt?.planId === state.planId && closeoutAttempt?.terminalEpoch === state.terminalEpoch && closeoutAttempt?.executionId === closeoutExecutionIdentity(state)))) {
			state = transitionPlanLifecycle(state, { type: "closeout", state: { kind: "attention", planId: state.planId!, terminalEpoch: state.terminalEpoch, executionId: closeoutExecutionIdentity(state), reason: "missing-complete" } });
			closeoutAttempt = undefined;
			persist(); updateUi(ctx);
			ctx.ui.notify("Plan closeout still needs attention. Use /plan-review to retry.", "warning");
			return;
		}
		const last = latestAssistant(ctx);
		if (!last || state.continuation.waitFor) return;
		if (!canClosePlan(state) && last.timestamp !== handledStoppedAssistantTimestamp) { handledStoppedAssistantTimestamp = last.timestamp; const expected = captureGuard(); const current = pendingSteps(state)[0]; const choice = await ctx.ui.select(`${last.stopReason === "aborted" ? "Execution interrupted" : "Execution stopped before all plan steps were terminal"}${current ? `\n\nCurrent step ${current.step}: ${current.text}` : ""}`, ["Resume current step", "Recalibrate plan", "Adjust statuses", "Pause plan"]); if (!isCurrent(ctx, expected)) return; if (choice === "Resume current step") { state = { ...state, continuation: resetExecutionContinuation() }; persist(); updateUi(ctx); pi.sendMessage({ customType: "plan-resume", content: renderExecutionContext(state, state.executionSource ?? { sessionId, cwd: ctx.cwd }, "resume"), display: true }, { triggerTurn: true, deliverAs: "followUp" }); } else if (choice === "Recalibrate plan") await requestRevision(ctx); else if (choice === "Adjust statuses") await showTodos(ctx); else if (choice === "Pause plan") await pause(ctx); return; }
	});
	pi.on("session_start", async (_event, ctx) => {
		// Session replacement invalidates every dialog, model change, and watcher callback.
		revision++;
		sessionId = ctx.sessionManager.getSessionId();
		lifecycle.startSession(sessionId, leafId(ctx));
		sessionFile = ctx.sessionManager.getSessionFile();
		sessionCwd = ctx.cwd;
		internalPlan = branchInternalPlan(ctx);
		watchProjectHistory(ctx);
		const packet = process.env.PI_PLAN_HANDOFF ? consumeExecutionPacket(agentDir, process.env.PI_PLAN_HANDOFF) : undefined;
		if (packet) { state = { ...packet.plan, version: 7, phase: "executing", accessMode: "none", currentPaneTransfer: undefined, executionSource: packet.source, planningModel: snapshotModel(ctx), executionModel: packet.model, executionId: randomUUID(), toolsBeforePlan: pi.getActiveTools().filter((name) => !PLAN_EXECUTION_TOOLS.includes(name)), executionClaim: { path: process.env.PI_PLAN_HANDOFF!, token: packet.claimToken } }; state = materializePlan(state); activeHandoff = { path: process.env.PI_PLAN_HANDOFF!, claimToken: packet.claimToken }; executionTools(); persist(); updateUi(ctx); if (!acknowledgeExecutionPacket(agentDir, process.env.PI_PLAN_HANDOFF!, packet.claimToken)) ctx.ui.notify("Execution claimed the handoff but could not record readiness.", "warning"); pi.sendMessage({ customType: "plan-execution-kickoff", content: renderExecutionContext(state, packet.source), display: true }, { triggerTurn: true, deliverAs: "followUp" }); return; }
		let restored = branchExecutionTransfer(ctx) ? createPlanState() : branchPlanState(ctx);
		if (!restored) { const legacy = readPlanFile(agentDir, sessionId); if (legacy.length) restored = { ...createPlanState(), phase: "paused", steps: legacy }; }
		const priorPlanId = restored?.planId;
		const guard = captureGuard();
		if (!(await activateRestoredState(ctx, restored ?? createPlanState(), guard))) return;
		// A terminal closeout continuation cannot survive a process reload: it may
		// already have been delivered. Pending-work rescue state stays durable.
		const restoredCloseout = restoreInterruptedCloseout();
		// Recovery cleanup is deliberately never tokenless on startup. A resumed
		// process must explicitly reclaim a verified-dead recovery owner first.
		if ((state.planId && !priorPlanId) || restoredCloseout) persist();
		if (pi.getFlag("plan") === true && state.accessMode === "none" && state.phase !== "handed-off") enterPlan(ctx);
		refreshCompletedHistory(ctx);
		syncLivePlan();
		updateUi(ctx);
	});
	pi.on("session_tree", async (_event, ctx) => {
		// Appending to this branch retains the captured leaf. Ancestor/sibling navigation
		// advances the lifecycle generation before any awaited restoration can commit.
		const changedBranch = lifecycle.observeBranch(ctx.sessionManager.getSessionId(), leafId(ctx), branchIds(ctx));
		if (changedBranch) revision++;
		internalPlan = branchInternalPlan(ctx);
		const guard = captureGuard();
		if (!(await activateRestoredState(ctx, branchExecutionTransfer(ctx) ? createPlanState() : branchPlanState(ctx) ?? createPlanState(), guard, true))) return;
		if (restoreInterruptedCloseout()) persist();
		refreshCompletedHistory(ctx);
		syncLivePlan();
		updateUi(ctx);
	});
	pi.on("session_shutdown", async (_event, ctx) => {
		lifecycle.invalidate();
		revision++;
		removeLivePlan(process.pid, sessionId);
		if (historyRefreshTimer) clearTimeout(historyRefreshTimer);
		closeHistoryWatcher?.();
		closeHistoryWatcher = undefined;
		if (state.phase === "executing" || state.phase === "revising") await restorePlanningModel(ctx);
	});
}
