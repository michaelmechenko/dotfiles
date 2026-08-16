import type { AgentMessage } from "@earendil-works/pi-agent-core";
import { getSupportedThinkingLevels, StringEnum, type AssistantMessage } from "@earendil-works/pi-ai";
import { copyToClipboard, getAgentDir, getSettingsListTheme, SettingsManager, type ExtensionAPI, type ExtensionCommandContext, type ExtensionContext } from "@earendil-works/pi-coding-agent";
import { Container, Key, matchesKey, type SettingItem, SettingsList, truncateToWidth } from "@earendil-works/pi-tui";
import { Type } from "typebox";
import { isModelSnapshot, loadPlanModeConfig, savePlanModeConfig } from "./config.ts";
import { acknowledgeExecutionPacket, buildTmuxDetachedPaneArgs, buildTmuxNewWindowArgs, consumeExecutionPacket, deleteExecutionPacket, renderPlanMarkdown, waitForExecutionAcknowledgement, waitForRelease, writeWorkerReport, type TmuxTarget, writeExecutionPacket } from "./execution-handoff.ts";
import { applyWorkerReports, createParallelRun, launchParallelRun, readParallelRun, reconcileParallelRun } from "./execution-orchestrator.ts";
import { executionGuidance, renderExecutionContext } from "./execution-context.ts";
import { candidateFor, createExecutionSettings, resolveExecutionSettings, type ExecutionDestination, type ExecutionSettings, type ModelCandidate } from "./execution-settings.ts";
import { deletePlanFile, readPlanFile, writePlanFile } from "./plan-file.ts";
import { applyPlanUpdate, canClosePlan, createPlanState, enterRestrictedMode, isStepDone, leaveRestrictedMode, migratePlanState, pendingSteps, type ModelSnapshot, type PlanCloseout, type PlanState, type ThinkingLevel, type WorkstreamInput } from "./plan-state.ts";
import { checkRestrictedToolCall, checkRestrictedUserBash, PLAN_EXECUTION_TOOLS, PLAN_UPDATE_TOOL, restrictedTools, restrictionGuidance } from "./restricted-mode.ts";
import { parsePlanEditText, type TodoItem } from "./utils.ts";

const PLAN_STEP_TOOL = "plan_step";
const PLAN_COMPLETE_TOOL = "plan_complete";
const CONTEXT_TYPES = new Set(["plan-mode-context", "read-only-mode-context"]);

const PlanStepParams = Type.Object({
	action: StringEnum(["complete", "uncomplete", "skip", "list"] as const),
	step: Type.Optional(Type.Integer({ minimum: 1 })),
});
const PlanUpdateParams = Type.Object({
	goal: Type.String({ minLength: 1 }), steps: Type.Array(Type.String({ minLength: 1 }), { minItems: 1 }),
	criteria: Type.Optional(Type.Array(Type.String({ minLength: 1 }))), followUps: Type.Optional(Type.Array(Type.String({ minLength: 1 }))),
	executionBrief: Type.Object({ summary: Type.String({ minLength: 1 }), findings: Type.Array(Type.String({ minLength: 1 })), decisions: Type.Array(Type.String({ minLength: 1 })), relevantFiles: Type.Array(Type.Object({ path: Type.String({ minLength: 1 }), note: Type.String({ minLength: 1 }) })), constraints: Type.Array(Type.String({ minLength: 1 })) }),
	workstreams: Type.Optional(Type.Array(Type.Object({ id: Type.String({ minLength: 1 }), title: Type.String({ minLength: 1 }), objective: Type.String({ minLength: 1 }), steps: Type.Array(Type.Integer({ minimum: 1 }), { minItems: 1 }), ownedPaths: Type.Array(Type.String({ minLength: 1 }), { minItems: 1 }) }), { minItems: 2, maxItems: 6 })),
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
	return steps.map((step) => `${step.step}. [${step.completed ? "x" : step.skipped ? "-" : " "}] ${step.text}`).join("\n");
}
function isAssistantMessage(message: AgentMessage): message is AssistantMessage {
	return message.role === "assistant" && Array.isArray(message.content);
}

/** Pi's public setters write global defaults; restore only those fields afterwards. A forced process kill between the two calls remains the narrow unavoidable window. */
export async function setExecutionModelPreservingDefaults(pi: ExtensionAPI, ctx: ExtensionContext, model: ModelSnapshot, agentDir: string): Promise<boolean> {
	const before = SettingsManager.create(ctx.cwd, agentDir);
	const defaults = {
		provider: before.getDefaultProvider(),
		model: before.getDefaultModel(),
		thinking: before.getDefaultThinkingLevel(),
	};
	try {
		const resolved = ctx.modelRegistry.find(model.provider, model.model);
		if (!resolved || !(await pi.setModel(resolved))) return false;
		pi.setThinkingLevel(model.thinkingLevel);
		return true;
	} finally {
		const restore = SettingsManager.create(ctx.cwd, agentDir);
		if (defaults.provider && defaults.model) restore.setDefaultModelAndProvider(defaults.provider, defaults.model);
		else if (defaults.provider) restore.setDefaultProvider(defaults.provider);
		else if (defaults.model) restore.setDefaultModel(defaults.model);
		if (defaults.thinking) restore.setDefaultThinkingLevel(defaults.thinking);
		await restore.flush();
	}
}

export default function planModeExtension(pi: ExtensionAPI): void {
	let state = createPlanState();
	let sessionId = "";
	let handledStoppedAssistantTimestamp: number | undefined;
	let workerReportPath: string | undefined;
	let pendingCurrentPanePacket: { handoffPath: string; saveDefault: boolean } | undefined;
	const agentDir = getAgentDir();

	function availableTools(): string[] { return pi.getAllTools().map((tool) => tool.name); }
	function persist(): void {
		pi.appendEntry("plan-mode", state);
		if (state.steps.length && sessionId) writePlanFile(agentDir, sessionId, state.steps);
	}
	function setTools(names: string[]): void { pi.setActiveTools([...new Set(names)].filter((name) => availableTools().includes(name))); }
	function applyRestrictedTools(): void { setTools(restrictedTools(state.accessMode, availableTools())); }
	function executionTools(): void { setTools([...(state.toolsBeforePlan ?? pi.getActiveTools()), ...PLAN_EXECUTION_TOOLS]); }
	function restoreTools(clearSnapshot = false): void {
		if (state.toolsBeforePlan) setTools(state.toolsBeforePlan);
		else setTools(pi.getActiveTools().filter((name) => !PLAN_EXECUTION_TOOLS.includes(name)));
		if (clearSnapshot) state = { ...state, toolsBeforePlan: undefined };
	}
	function planContext(): string {
		return `Goal: ${state.goal}\n\nSteps:\n${formatSteps(state.steps)}${state.criteria.length ? `\n\nVerification criteria:\n${state.criteria.map((item) => `- ${item}`).join("\n")}` : ""}${state.followUps.length ? `\n\nKnown follow-up work:\n${state.followUps.map((item) => `- ${item}`).join("\n")}` : ""}`;
	}
	function updateUi(ctx: ExtensionContext): void {
		if (state.phase === "executing" && state.steps.length) {
			const done = state.steps.filter(isStepDone).length;
			ctx.ui.setStatus("plan-mode", ctx.ui.theme.fg("accent", `plan ${done}/${state.steps.length}`));
		} else if (state.accessMode === "read-only") ctx.ui.setStatus("plan-mode", ctx.ui.theme.fg("warning", "read-only"));
		else if (state.accessMode === "plan") ctx.ui.setStatus("plan-mode", ctx.ui.theme.fg("warning", state.phase === "revising" ? "plan (recalibrating)" : "plan (planning)"));
		else if (state.phase === "paused") ctx.ui.setStatus("plan-mode", ctx.ui.theme.fg("warning", "none (plan paused)"));
		else if (state.phase === "handed-off") ctx.ui.setStatus("plan-mode", ctx.ui.theme.fg("warning", state.parallelRun ? `parallel (${state.parallelRun.phase})` : "plan (handed off)"));
		else ctx.ui.setStatus("plan-mode", undefined);
		if (state.phase !== "executing" || !state.steps.length) return ctx.ui.setWidget("plan-todos", undefined);
		const done = state.steps.filter(isStepDone).length;
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
		state = enterRestrictedMode(state, "plan", pi.getActiveTools());
		if (!state.planningModel) state = { ...state, planningModel: snapshotModel(ctx) };
		applyRestrictedTools(); persist(); updateUi(ctx);
	}
	function enterReadOnly(ctx: ExtensionContext): void {
		state = enterRestrictedMode(state, "read-only", pi.getActiveTools());
		applyRestrictedTools(); persist(); updateUi(ctx);
	}
	async function restorePlanningModel(ctx: ExtensionContext): Promise<void> {
		if (state.planningModel) await setExecutionModelPreservingDefaults(pi, ctx, state.planningModel, agentDir);
	}
	async function leaveReadOnly(ctx: ExtensionContext): Promise<void> {
		const transition = leaveRestrictedMode(state);
		state = transition.state;
		if (transition.restoreTools) setTools(transition.restoreTools);
		persist(); updateUi(ctx);
	}
	async function pause(ctx: ExtensionContext): Promise<void> {
		if (!state.steps.length && state.phase === "idle") return;
		state = { ...state, phase: "paused", accessMode: "none", awaitingReview: false, resumeAfterRevision: false };
		restoreTools(); await restorePlanningModel(ctx); persist(); updateUi(ctx);
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
		const saved = loadPlanModeConfig(agentDir).executionModel;
		const candidates = executionCandidates(ctx, current, saved);
		let settings = createExecutionSettings(current, tmux ? "tmux-pane" : "current", "saved");
		return ctx.ui.custom<ExecutionSettings | undefined>((tui, theme, _kb, done) => {
			const destinations: { value: ExecutionDestination; label: string }[] = [
				{ value: "current", label: "Current Pi session" },
				{ value: "clipboard", label: "Copy plan to clipboard" },
				...(tmux ? [{ value: "tmux-current" as const, label: "New Pi session in current pane" }, { value: "tmux-pane" as const, label: "Detached pane in current tmux window" }, { value: "tmux-window" as const, label: "Detached window in current tmux session" }] : []),
			];
			let list: SettingsList;
			let selectedId = "destination";
			const refresh = () => { const rows = items(); const next = new SettingsList(rows, 10, getSettingsListTheme(), change, () => done(undefined)); (next as unknown as { selectedIndex: number }).selectedIndex = Math.max(0, rows.findIndex((row) => row.id === selectedId)); list = next; tui.requestRender(); };
			const item = (id: string, label: string, currentValue: string, values: string[], description?: string): SettingItem => ({ id, label, currentValue, values, description });
			const items = (): SettingItem[] => {
				const destination = destinations.find((value) => value.value === settings.destination) ?? destinations[0]!;
				const rows: SettingItem[] = [item("destination", "Destination", destination.label, destinations.map((value) => value.label))];
				if (settings.destination !== "clipboard") rows.push(item("policy", "Model policy", settings.modelPolicy === "current" ? "Current session model" : settings.modelPolicy === "saved" ? "Saved plan default" : "Choose model", ["Current session model", "Saved plan default", "Choose model"]));
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
			const container = new Container();
			container.addChild({ render: () => [theme.fg("accent", theme.bold("Execution settings")), theme.fg("dim", "↑↓ select • enter/space cycle • esc cancel"), ""], invalidate() {} });
			refresh();
			container.addChild({ render: (width: number) => list.render(width), invalidate: () => list.invalidate(), handleInput: (data: string) => list.handleInput(data) });
			return { render: (width) => container.render(width), invalidate: () => container.invalidate(), handleInput: (data) => { if (matchesKey(data, Key.escape) || matchesKey(data, "ctrl+c")) return done(undefined); list.handleInput(data); tui.requestRender(); } };
		});
	}
	async function beginExecution(ctx: ExtensionContext, model: ModelSnapshot, source?: { sessionId: string; cwd: string; tmuxSession?: string }): Promise<boolean> {
		if (!state.steps.length || !isModelSnapshot(model)) return false;
		const resolved = ctx.modelRegistry.find(model.provider, model.model);
		if (!resolved) { ctx.ui.notify(`Execution model ${model.provider}/${model.model} is unavailable.`, "warning"); return false; }
		const planningModel = state.planningModel ?? snapshotModel(ctx);
		if (!(await setExecutionModelPreservingDefaults(pi, ctx, model, agentDir))) { ctx.ui.notify(`Execution model ${model.provider}/${model.model} is unavailable or unauthenticated.`, "warning"); return false; }
		const executionSource = source ?? { sessionId, cwd: ctx.cwd };
		state = { ...state, planningModel, phase: "executing", accessMode: "none", executionModel: model, executionSource, awaitingReview: false, resumeAfterRevision: false, completionRequested: false };
		executionTools(); persist(); showPlan(ctx);
		pi.sendMessage({ customType: "plan-execution-kickoff", content: renderExecutionContext(state, executionSource), display: true }, { triggerTurn: true, deliverAs: "followUp" });
		return true;
	}
	async function replaceWithExecutionSession(ctx: ExtensionCommandContext, request: { handoffPath: string; saveDefault: boolean }): Promise<void> {
		const parentSession = ctx.sessionManager.getSessionFile();
		const result = await ctx.newSession({
			parentSession,
			setup: async (manager) => { manager.appendCustomEntry("plan-mode-new-session-execution", request); },
			withSession: async (replacement) => { await replacement.sendUserMessage("/plan-review", { expandPromptTemplates: true }); },
		});
		if (result.cancelled) deleteExecutionPacket(agentDir, request.handoffPath);
	}
	async function executeWizard(ctx: ExtensionContext): Promise<void> {
		const tmux = await resolveTmuxTarget();
		const settings = await executionSettings(ctx, tmux);
		if (!settings) return;
		const resolution = resolveExecutionSettings(settings, snapshotModel(ctx), loadPlanModeConfig(agentDir).executionModel, executionCandidates(ctx, snapshotModel(ctx), loadPlanModeConfig(agentDir).executionModel));
		if (!resolution.ok) return ctx.ui.notify(resolution.error, "warning");
		if (resolution.value.destination === "clipboard") { await copyToClipboard(renderPlanMarkdown(state)); ctx.ui.notify("Plan copied to the clipboard.", "info"); return; }
		const model = resolution.value.model!;
		if (resolution.value.destination === "current") { if (await beginExecution(ctx, model) && resolution.value.saveDefault) savePlanModeConfig(model, agentDir); return; }
		if (!tmux) return;
		const source = { sessionId, cwd: ctx.cwd, tmuxSession: tmux.session };
		if (resolution.value.destination === "tmux-current") {
			pendingCurrentPanePacket = { handoffPath: writeExecutionPacket(agentDir, { version: 2, plan: { ...state, phase: "executing", accessMode: "none" }, source, model }), saveDefault: resolution.value.saveDefault };
			pi.sendUserMessage("/plan-review", { expandPromptTemplates: true });
			return;
		}
		if (state.workstreams?.length) {
			try {
				const run = createParallelRun(agentDir, { ...state, phase: "executing", accessMode: "none" }, source, model);
				const launched = await launchParallelRun((args, timeout) => pi.exec("tmux", args, { timeout }), agentDir, run, state);
				state = { ...state, phase: "handed-off", accessMode: "none", awaitingReview: false, parallelRun: { id: launched.id, phase: launched.phase } };
				restoreTools(true); await restorePlanningModel(ctx); persist(); updateUi(ctx);
			} catch (error) { ctx.ui.notify(`Could not launch parallel handoff: ${error instanceof Error ? error.message : "tmux failed"}`, "warning"); }
			return;
		}
		const packetPath = writeExecutionPacket(agentDir, { version: 2, plan: { ...state, phase: "executing", accessMode: "none" }, source, model });
		const args = resolution.value.destination === "tmux-pane" ? buildTmuxDetachedPaneArgs(tmux, ctx.cwd, packetPath, model, resolution.value.paneDirection) : buildTmuxNewWindowArgs(tmux, ctx.cwd, packetPath, model);
		try {
			const launch = await pi.exec("tmux", args, { timeout: 5_000 });
			if (launch.code !== 0) throw new Error(launch.stderr.trim() || "tmux failed");
		} catch (error) {
			deleteExecutionPacket(agentDir, packetPath);
			return ctx.ui.notify(`Could not launch tmux handoff: ${error instanceof Error ? error.message : "tmux failed"}`, "warning");
		}
		if (!(await waitForExecutionAcknowledgement(agentDir, packetPath))) { deleteExecutionPacket(agentDir, packetPath); return ctx.ui.notify("Tmux handoff did not acknowledge startup; the plan remains ready.", "warning"); }
		deleteExecutionPacket(agentDir, packetPath);
		if (resolution.value.saveDefault) savePlanModeConfig(model, agentDir);
		state = { ...state, phase: "handed-off", accessMode: "none", awaitingReview: false };
		restoreTools(true); await restorePlanningModel(ctx); persist(); updateUi(ctx);
	}
	async function requestRevision(ctx: ExtensionContext, request?: string): Promise<void> {
		const changeRequest = request ?? await ctx.ui.editor("Recalibrate this plan:", "");
		if (!changeRequest?.trim()) return;
		state = { ...state, phase: "revising", accessMode: "plan", awaitingReview: false, resumeAfterRevision: true, completionRequested: false };
		applyRestrictedTools(); await restorePlanningModel(ctx); persist(); updateUi(ctx);
		pi.sendUserMessage(`${renderExecutionContext(state, state.executionSource ?? { sessionId, cwd: ctx.cwd }, "recalibration")}\n\nUser requested changes:\n${changeRequest.trim()}`, { deliverAs: "followUp" });
	}
	async function closePlan(ctx: ExtensionContext, closeout: PlanCloseout): Promise<void> {
		const planningModel = state.planningModel;
		pi.sendMessage({ customType: "plan-complete", content: `## Plan complete\n\n**Goal:** ${state.goal}\n\n**Outcome:** ${closeout.outcome}\n\n**End state:** ${closeout.endState}\n\n**Verification:**\n${closeout.verification.map((item) => `- ${item}`).join("\n")}\n\n**Deviations:**\n${(closeout.deviations.length ? closeout.deviations : ["None."]).map((item) => `- ${item}`).join("\n")}\n\n**Next steps:**\n${(closeout.nextSteps.length ? closeout.nextSteps : state.followUps.length ? state.followUps : ["No further work identified."]).map((item) => `- ${item}`).join("\n")}`, display: true }, { triggerTurn: false });
		restoreTools();
		if (planningModel) await setExecutionModelPreservingDefaults(pi, ctx, planningModel, agentDir);
		if (workerReportPath) { writeWorkerReport(workerReportPath, { completedAt: Date.now(), closeout, steps: state.steps }); workerReportPath = undefined; }
		state = createPlanState();
		if (sessionId) deletePlanFile(agentDir, sessionId);
		persist(); updateUi(ctx);
	}
	async function reviewPlan(ctx: ExtensionCommandContext): Promise<void> {
		if (pendingCurrentPanePacket) {
			const request = pendingCurrentPanePacket;
			pendingCurrentPanePacket = undefined;
			try { await replaceWithExecutionSession(ctx, request); } catch (error) { deleteExecutionPacket(agentDir, request.handoffPath); ctx.ui.notify(`Could not create the execution session: ${error instanceof Error ? error.message : "session replacement failed"}`, "warning"); }
			return;
		}
		const request = [...ctx.sessionManager.getBranch()].reverse().find((entry) => entry.type === "custom" && entry.customType === "plan-mode-new-session-execution") as { data?: { handoffPath?: unknown; saveDefault?: unknown } } | undefined;
		const handoffPath = typeof request?.data?.handoffPath === "string" ? request.data.handoffPath : undefined;
		const saveDefault = request?.data?.saveDefault === true;
		if (handoffPath && !state.steps.length) {
			const packet = consumeExecutionPacket(agentDir, handoffPath);
			if (!packet || !acknowledgeExecutionPacket(agentDir, handoffPath)) return ctx.ui.notify("The new-session execution handoff is unavailable.", "warning");
			state = { ...packet.plan, version: 5, phase: "ready", accessMode: "none", awaitingReview: false, executionSource: packet.source, planningModel: undefined, toolsBeforePlan: pi.getActiveTools().filter((name) => !PLAN_EXECUTION_TOOLS.includes(name)) };
			const started = await beginExecution(ctx, packet.model, packet.source);
			if (started && saveDefault) savePlanModeConfig(packet.model, agentDir);
			deleteExecutionPacket(agentDir, handoffPath);
			return;
		}
		if (!state.steps.length) { enterPlan(ctx); return; }
		if (state.parallelRun) {
			const run = readParallelRun(agentDir, state.parallelRun.id);
			if (!run) return ctx.ui.notify("Parallel run record is unavailable; recalibrate the plan.", "warning");
			const reconciled = reconcileParallelRun(agentDir, run);
			state = { ...applyWorkerReports(state, reconciled), parallelRun: { id: reconciled.id, phase: reconciled.phase } };
			persist();
			if (reconciled.phase !== "reported") return ctx.ui.notify(`Parallel workers are ${reconciled.phase}; reports are not all available.`, "info");
			state = { ...state, phase: "executing", accessMode: "none", completionRequested: false };
			executionTools(); showPlan(ctx);
			pi.sendMessage({ customType: "plan-parallel-closeout", content: "All parallel worker reports are available. Verify cross-workstream integration, then call plan_complete.", display: true }, { triggerTurn: true, deliverAs: "followUp" });
			return;
		}
		const choice = await ctx.ui.select("Current plan",  ["Execute", "Recalibrate from current state", "Edit steps manually", "Pause plan", "Discard plan"]);
		if (choice === "Execute") await executeWizard(ctx);
		else if (choice === "Recalibrate from current state") await requestRevision(ctx);
		else if (choice === "Edit steps manually") {
			const text = await ctx.ui.editor("Edit top-level plan steps:", state.steps.map((step) => `${step.step}. ${step.text}`).join("\n"));
			const steps = text ? parsePlanEditText(text) : [];
			if (steps.length) { state = applyPlanUpdate(state, { goal: state.goal, steps, criteria: state.criteria, followUps: state.followUps, executionBrief: state.executionBrief }); persist(); showPlan(ctx); }
		} else if (choice === "Pause plan") await pause(ctx);
		else if (choice === "Discard plan") { restoreTools(); state = createPlanState(); if (sessionId) deletePlanFile(agentDir, sessionId); persist(); updateUi(ctx); }
	}
	async function showTodos(ctx: ExtensionContext): Promise<void> {
		if (!state.steps.length) return;
		await ctx.ui.custom<void>((tui, theme, _kb, done) => {
			let index = 0; let cache: string[] | undefined;
			const refresh = () => { cache = undefined; tui.requestRender(); };
			return { render(width) { if (cache) return cache; cache = [theme.fg("accent", " Plan Progress "), ...state.steps.map((step, i) => truncateToWidth(`${i === index ? theme.fg("accent", " ❯ ") : "   "}${step.completed ? theme.fg("success", "[x] ") : step.skipped ? theme.fg("dim", "[-] ") : theme.fg("muted", "[ ] ")}${step.text}`, width)), theme.fg("dim", " ↑↓ navigate • space cycle status • esc close")]; return cache; }, invalidate() { cache = undefined; }, handleInput(data) { if (matchesKey(data, Key.escape) || matchesKey(data, "ctrl+c")) return done(); if (matchesKey(data, Key.up)) { index = (index - 1 + state.steps.length) % state.steps.length; refresh(); } else if (matchesKey(data, Key.down)) { index = (index + 1) % state.steps.length; refresh(); } else if (matchesKey(data, Key.space) || matchesKey(data, Key.enter)) { const step = state.steps[index]!; if (!step.completed && !step.skipped) step.completed = true; else if (step.completed) { step.completed = false; step.skipped = true; } else step.skipped = false; persist(); updateUi(ctx); refresh(); } } };
		});
	}

	pi.registerFlag("plan", { description: "Start in structured read-only plan mode", type: "boolean", default: false });
	pi.registerCommand("plan", { description: "Enter structured planning or pause an active execution", handler: async (_args, ctx) => { if (!ctx.isIdle()) return ctx.ui.notify("Wait for the active turn before changing mode.", "warning"); if (state.phase === "executing") await pause(ctx); enterPlan(ctx); } });
	pi.registerCommand("read-only", { description: "Enter standalone read-only inspection mode", handler: async (_args, ctx) => { if (!ctx.isIdle()) return ctx.ui.notify("Wait for the active turn before changing mode.", "warning"); enterReadOnly(ctx); } });
	pi.registerCommand("mode", { description: "Cycle none, plan, and read-only access modes", handler: async (_args, ctx) => { if (!ctx.isIdle()) return ctx.ui.notify("Wait for the active turn before changing mode.", "warning"); if (state.accessMode === "none") enterPlan(ctx); else if (state.accessMode === "plan") enterReadOnly(ctx); else await leaveReadOnly(ctx); } });
	pi.registerCommand("plan-review", { description: "Execute, recalibrate, pause, or discard the active plan", handler: async (_args, ctx) => reviewPlan(ctx) });
	pi.registerCommand("plan-edit", { description: "Edit top-level steps in the active plan", handler: async (_args, ctx) => { if (!state.steps.length) return ctx.ui.notify("No active plan.", "info"); const text = await ctx.ui.editor("Edit top-level plan steps:", state.steps.map((step) => `${step.step}. ${step.text}`).join("\n")); const steps = text ? parsePlanEditText(text) : []; if (steps.length) { state = applyPlanUpdate(state, { goal: state.goal, steps, criteria: state.criteria, followUps: state.followUps, executionBrief: state.executionBrief }); persist(); showPlan(ctx); } } });
	pi.registerCommand("plan-widget", { description: "Toggle collapsed plan progress", handler: async (_args, ctx) => { state = { ...state, widgetCollapsed: !state.widgetCollapsed }; persist(); updateUi(ctx); } });
	pi.registerCommand("todos", { description: "View or correct plan progress", handler: async (_args, ctx) => showTodos(ctx) });
	pi.registerCommand("pause", { description: "Pause plan execution", handler: async (_args, ctx) => pause(ctx) });
	pi.registerShortcut(Key.ctrl("p"), { description: "Cycle none → plan → read-only → none", handler: async (ctx) => { if (!ctx.isIdle()) return ctx.ui.notify("Wait for the active turn before changing mode.", "warning"); if (state.phase === "executing") { await pause(ctx); enterPlan(ctx); return; } if (state.accessMode === "none") enterPlan(ctx); else if (state.accessMode === "plan") enterReadOnly(ctx); else await leaveReadOnly(ctx); } });
	pi.registerShortcut(Key.ctrlAlt("p"), { description: "Toggle collapsed plan progress", handler: async (ctx) => { state = { ...state, widgetCollapsed: !state.widgetCollapsed }; persist(); updateUi(ctx); } });
	pi.registerShortcut(Key.ctrlAlt("t"), { description: "Toggle collapsed plan progress", handler: async (ctx) => { state = { ...state, widgetCollapsed: !state.widgetCollapsed }; persist(); updateUi(ctx); } });

	pi.registerTool({ name: PLAN_UPDATE_TOOL, label: "Plan Update", description: "Create or revise the structured active plan.", promptSnippet: "Create or revise the structured active plan", promptGuidelines: ["Call plan_update after planning and when scope or blockers change pending work."], parameters: PlanUpdateParams, async execute(_id, params, _signal, _update, ctx) { if (state.accessMode !== "plan" && state.phase !== "executing") throw new Error("plan_update requires planning or execution."); state = applyPlanUpdate(state, params as typeof params & { workstreams?: WorkstreamInput[] }); if (state.phase === "revising" && state.resumeAfterRevision) { persist(); await beginExecution(ctx, state.executionModel ?? loadPlanModeConfig(agentDir).executionModel); } else { persist(); updateUi(ctx); } return { content: [{ type: "text", text: `Plan updated with ${state.steps.length} step(s).\n${planContext()}` }], details: { state } }; } });
	pi.registerTool({ name: PLAN_STEP_TOOL, label: "Plan Step", description: "Track an approved plan step during execution.", promptSnippet: "Mark an executing plan step complete or skipped", promptGuidelines: ["Call plan_step immediately after each executed or skipped step."], parameters: PlanStepParams, async execute(_id, params) { if (state.phase !== "executing") throw new Error("plan_step is available only while executing."); if (params.action === "list") return { content: [{ type: "text", text: formatSteps(state.steps) }], details: { state } }; const step = params.step === undefined ? undefined : state.steps.find((item) => item.step === params.step); if (!step) throw new Error("plan_step requires a valid step."); if (params.action === "complete") { step.completed = true; step.skipped = false; } else if (params.action === "skip") { step.completed = false; step.skipped = true; } else { step.completed = false; step.skipped = false; } persist(); return { content: [{ type: "text", text: `Step ${step.step} marked ${params.action}: ${step.text}` }], details: { state } }; } });
	pi.registerTool({ name: PLAN_COMPLETE_TOOL, label: "Plan Complete", description: "Record the final plan outcome.", promptSnippet: "Record the final plan outcome and next steps", promptGuidelines: ["Call plan_complete after every plan step is terminal."], parameters: PlanCompleteParams, async execute(_id, params, _signal, _update, ctx) { if (!canClosePlan(state)) throw new Error("plan_complete requires every plan step to be terminal."); const closeout: PlanCloseout = { ...params, deviations: params.deviations ?? [], nextSteps: params.nextSteps ?? [] }; await closePlan(ctx, closeout); return { content: [{ type: "text", text: "Plan closeout recorded." }], details: { closeout } }; } });

	pi.on("tool_call", async (event) => { const reason = checkRestrictedToolCall(state.accessMode, event.toolName, event.input); return reason ? { block: true, reason } : undefined; });
	pi.on("user_bash", async (event) => { const reason = checkRestrictedUserBash(state.accessMode, event.command); return reason ? { result: { output: reason, exitCode: 126, cancelled: false, truncated: false } } : undefined; });
	pi.on("context", async (event) => ({ messages: event.messages.filter((message) => { const type = (message as { customType?: string }).customType; if (!type || !CONTEXT_TYPES.has(type)) return true; return (type === "plan-mode-context" && state.accessMode === "plan") || (type === "read-only-mode-context" && state.accessMode === "read-only"); }) }));
	pi.on("before_agent_start", async (event) => { const guidance = restrictionGuidance(state.accessMode); if (guidance) return { systemPrompt: `${event.systemPrompt}\n\n${guidance}` }; if (state.phase === "executing") return { systemPrompt: `${event.systemPrompt}\n\n${executionGuidance()}` }; });
	pi.on("agent_settled", async (_event, ctx) => {
		if (state.phase === "ready" && state.awaitingReview && state.accessMode === "plan") { state = { ...state, awaitingReview: false }; persist(); showPlan(ctx); const choice = await ctx.ui.select("Plan ready", ["Execute", "Recalibrate plan", "Stay in plan mode"]); if (choice === "Execute") await executeWizard(ctx); else if (choice === "Recalibrate plan") await requestRevision(ctx); return; }
		if (state.phase !== "executing") return;
		const last = [...ctx.sessionManager.getBranch()].reverse().find((entry) => entry.type === "message" && isAssistantMessage(entry.message as AgentMessage)) as { message: AssistantMessage } | undefined;
		if (!last) return;
		if (!canClosePlan(state) && last.message.timestamp !== handledStoppedAssistantTimestamp) { handledStoppedAssistantTimestamp = last.message.timestamp; const current = pendingSteps(state)[0]; const choice = await ctx.ui.select(`${last.message.stopReason === "aborted" ? "Execution interrupted" : "Execution stopped before all plan steps were terminal"}${current ? `\n\nCurrent step ${current.step}: ${current.text}` : ""}`, ["Resume current step", "Recalibrate plan", "Adjust statuses", "Pause plan"]); if (choice === "Resume current step") pi.sendMessage({ customType: "plan-resume", content: renderExecutionContext(state, state.executionSource ?? { sessionId, cwd: ctx.cwd }, "resume"), display: true }, { triggerTurn: true, deliverAs: "followUp" }); else if (choice === "Recalibrate plan") await requestRevision(ctx); else if (choice === "Adjust statuses") await showTodos(ctx); else if (choice === "Pause plan") await pause(ctx); return; }
		if (canClosePlan(state) && !state.completionRequested) { state = { ...state, completionRequested: true }; persist(); pi.sendMessage({ customType: "plan-closeout-request", content: "All plan steps are terminal. Call plan_complete now.", display: true }, { triggerTurn: true, deliverAs: "followUp" }); }
	});
	pi.on("session_start", async (_event, ctx) => {
		sessionId = ctx.sessionManager.getSessionId();
		const packet = process.env.PI_PLAN_HANDOFF ? consumeExecutionPacket(agentDir, process.env.PI_PLAN_HANDOFF) : undefined;
		if (packet) { state = { ...packet.plan, version: 5, phase: "executing", accessMode: "none", executionSource: packet.source, planningModel: snapshotModel(ctx), toolsBeforePlan: pi.getActiveTools().filter((name) => !PLAN_EXECUTION_TOOLS.includes(name)) }; workerReportPath = packet.reportPath; executionTools(); persist(); updateUi(ctx); if (!acknowledgeExecutionPacket(agentDir, process.env.PI_PLAN_HANDOFF!)) return; if (packet.releasePath && !(await waitForRelease(packet.releasePath))) { await pause(ctx); return; } pi.sendMessage({ customType: "plan-execution-kickoff", content: renderExecutionContext(state, packet.source), display: true }, { triggerTurn: true, deliverAs: "followUp" }); return; }
		const entry = [...ctx.sessionManager.getBranch()].reverse().find((item) => item.type === "custom" && item.customType === "plan-mode") as { data?: unknown } | undefined;
		const restored = migratePlanState(entry?.data);
		if (restored) state = restored;
		else { const legacy = readPlanFile(agentDir, sessionId); if (legacy.length) state = { ...createPlanState(), phase: "paused", steps: legacy }; }
		if (state.parallelRun) { const run = readParallelRun(agentDir, state.parallelRun.id); if (run) { const reconciled = reconcileParallelRun(agentDir, run); state = { ...state, parallelRun: { id: reconciled.id, phase: reconciled.phase } }; } }
		if (pi.getFlag("plan") === true && state.accessMode === "none") enterPlan(ctx);
		else if (state.accessMode !== "none") { if (!state.toolsBeforePlan) state = { ...state, toolsBeforePlan: pi.getActiveTools() }; applyRestrictedTools(); }
		else if (state.phase === "executing") executionTools();
		else restoreTools();
		updateUi(ctx);
	});
	pi.on("session_shutdown", async (_event, ctx) => { if (state.phase === "executing" || state.phase === "revising") await restorePlanningModel(ctx); });
}
