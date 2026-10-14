import assert from "node:assert/strict";
import { resolve } from "node:path";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import test from "node:test";
import { jiti } from "../test-runtime.mjs";
import { closeoutExecutionIdentity, createPlanState } from "./plan-state.ts";
import { executionOwner, writeExecutionPacket } from "./execution-handoff.ts";
import { writeFileSync, existsSync } from "node:fs";

const agentDir = mkdtempSync(resolve(tmpdir(), "pi-plan-integration-"));
process.env.PI_CODING_AGENT_DIR = agentDir;
const { default: register } = await jiti.import(resolve(import.meta.dirname, "index.ts"));

async function harness(initial = createPlanState()) {
	const commands = new Map<string, any>();
	const tools = new Map<string, any>();
	const handlers = new Map<string, any>();
	let active = ["read", "write", "bash", "plan_update", "plan_step", "plan_complete"];
	const entries = [{ type: "custom", customType: "plan-mode", data: initial }];
	const notifications: string[] = [];
	let busy = false;
	let leaf = "integration-leaf";
	const modelReleases: Array<() => void> = [];
	let blockModel = false;
	let modelSet = false;
	let modelSwitchDefault: string | undefined;
	const modelCalls: string[] = [];
	const thinkingLevels: string[] = [];
	let executionSettings: any;
	let holdTmuxLaunch = false;
	const tmuxReleases: Array<() => void> = [];
	const execCalls: string[][] = [];
	const messages: Array<{ message: any; options: any }> = [];
	const context: any = {
		cwd: agentDir, mode: "tui", isIdle: () => !busy, scopedModels: [],
		model: { provider: "test", id: "native" }, thinkingLevel: "low",
		modelRegistry: { find: (provider: string, model: string) => ({ provider, id: model, reasoning: true }), getAvailable: () => [] },
		sessionManager: { getSessionId: () => "integration-session", getSessionFile: () => undefined, getLeafId: () => leaf, getBranch: () => entries },
		ui: { theme: { fg: (_: string, text: string) => text }, setStatus() {}, setWidget() {}, notify: (message: string) => notifications.push(message), select: async () => "Discard plan", editor: async () => "1. Modified", confirm: async () => true, custom: async () => executionSettings },
	};
	// Pi's ExtensionRunner creates a fresh context for every event, while retaining
	// the same session manager. This catches accidental attribution by object identity.
	const eventContext = () => Object.create(context);
	const pi: any = { registerCommand: (name: string, value: any) => commands.set(name, value), registerTool: (value: any) => tools.set(value.name, value), registerShortcut() {}, registerFlag() {}, on: (name: string, value: any) => handlers.set(name, value), events: { on() {} }, getActiveTools: () => active, getAllTools: () => active.map((name) => ({ name })), setActiveTools: (value: string[]) => { active = value; }, setModel: async (model: any) => { if (blockModel) await new Promise<void>((resolve) => { modelReleases.push(resolve); }); modelSet = true; modelCalls.push(model.id); context.model = model; if (modelSwitchDefault) { context.thinkingLevel = modelSwitchDefault; void handlers.get("thinking_level_select")({ level: modelSwitchDefault }, eventContext()); void handlers.get("model_select")({ model }, eventContext()); } return true; }, setThinkingLevel: (level: string) => { context.thinkingLevel = level; thinkingLevels.push(level); void handlers.get("thinking_level_select")({ level }, eventContext()); }, appendEntry: (_: string, data: any) => entries.push({ type: "custom", customType: "plan-mode", data }), sendMessage: (message: any, options: any) => { messages.push({ message, options }); }, sendUserMessage() {}, getFlag: () => false, exec: async (command: string, args: string[]) => { execCalls.push([command, ...args]); if (args[0] === "display-message") return { code: 0, stdout: "work\t@1\t%1\n", stderr: "" }; if (holdTmuxLaunch) await new Promise<void>((resolve) => tmuxReleases.push(resolve)); return { code: 0, stdout: "", stderr: "" }; } };
	register(pi);
	await handlers.get("session_start")({ reason: "startup" }, context);
	return { commands, tools, handlers, context, notifications, messages, get active() { return active; }, set busy(value: boolean) { busy = value; }, setLeaf(value: string) { leaf = value; }, setBranch(value: any[]) { entries.splice(0, entries.length, ...value); }, setExecutionSettings(value: any) { executionSettings = value; }, emulateModelSwitch(defaultThinking: string) { modelSwitchDefault = defaultThinking; }, async userSelectModel(id: string, thinkingLevel: string) { await new Promise<void>((resolve) => setImmediate(resolve)); context.model = { provider: "test", id }; context.thinkingLevel = thinkingLevel; await handlers.get("thinking_level_select")({ level: thinkingLevel }, eventContext()); await handlers.get("model_select")({ model: context.model }, eventContext()); }, holdTmuxLaunch() { holdTmuxLaunch = true; }, releaseTmuxLaunch() { holdTmuxLaunch = false; tmuxReleases.shift()?.(); }, holdModel() { blockModel = true; }, releaseModel() { modelReleases.shift()?.(); }, releaseAllModels() { blockModel = false; while (modelReleases.length) modelReleases.shift()?.(); }, get modelCalls() { return modelCalls; }, get thinkingLevels() { return thinkingLevels; }, get modelSet() { return modelSet; }, get execCalls() { return execCalls; }, get state() { return entries.at(-1)!.data; } };
}

const brief = { summary: "Work", findings: [], decisions: [], relevantFiles: [], constraints: [] };

test("registered commands refuse to mutate during a turn and protect handed-off ownership", async () => {
	const h = await harness();
	await h.commands.get("plan").handler("", h.context);
	await h.tools.get("plan_update").execute("1", { goal: "Goal", steps: ["Do it"], executionBrief: brief }, undefined, undefined, h.context);
	const before = h.state;
	h.busy = true;
	for (const name of ["plan-review", "plan-edit", "todos", "pause", "mode"]) await h.commands.get(name).handler("", h.context);
	assert.equal(h.state, before);
	assert.equal(h.state.phase, "ready");
	const handedOff = { ...before, phase: "handed-off" as const, accessMode: "none" as const };
	const owned = await harness(handedOff);
	await owned.commands.get("pause").handler("", owned.context);
	await owned.commands.get("plan").handler("", owned.context);
	await owned.commands.get("plan-edit").handler("", owned.context);
	assert.equal(owned.state.phase, "handed-off");
	await owned.handlers.get("session_shutdown")({}, owned.context);
	await h.handlers.get("session_shutdown")({}, h.context);
});

test("/plan-recover requires a dead claim and explicit confirmation", async () => {
	const plan = { ...createPlanState(), planId: "recovery-test", createdAt: new Date().toISOString(), phase: "handed-off" as const, goal: "Recover", steps: [{ id: "one", step: 1, text: "Check work", completed: false, skipped: false }], executionBrief: brief, executionSource: { sessionId: "integration-session", cwd: agentDir, tmuxSession: "test" } };
	const packetPath = writeExecutionPacket(agentDir, { version: 2, plan, source: { sessionId: "integration-session", cwd: agentDir, tmuxSession: "test" }, model: { provider: "test", model: "executor", thinkingLevel: "off" } });
	writeFileSync(`${packetPath}.claim`, JSON.stringify({ pid: 99999999, processStartedAt: "old", token: "dead-token", planId: "recovery-test", sourceSessionId: "integration-session", claimedAt: "now" }), { mode: 0o600 });
	const h = await harness({ ...plan, handoffPath: packetPath, detachedHandoff: { handoffPath: packetPath, transferId: "detached", planId: "recovery-test", source: { sessionId: "integration-session", cwd: agentDir, tmuxSession: "test" }, sourceLeafId: "integration-leaf", destination: "tmux-pane", launch: { cwd: agentDir, session: "test", window: "@1", pane: "%1" } } });
	await h.commands.get("plan-recover").handler("", h.context);
	assert.equal(h.state.phase, "paused", h.notifications.join("; "));
	assert.equal(h.state.detachedHandoff, undefined);
	assert.equal(existsSync(packetPath), false);
	await h.handlers.get("session_shutdown")({}, h.context);
});

test("/plan-recover resumes a paused recovery after its owner crashes", async () => {
	const plan = { ...createPlanState(), planId: "paused-recovery", createdAt: new Date().toISOString(), phase: "paused" as const, goal: "Recover", steps: [{ id: "one", step: 1, text: "Check work", completed: false, skipped: false }], executionBrief: brief, executionSource: { sessionId: "integration-session", cwd: agentDir, tmuxSession: "test" } };
	const packetPath = writeExecutionPacket(agentDir, { version: 2, plan, source: { sessionId: "integration-session", cwd: agentDir, tmuxSession: "test" }, model: { provider: "test", model: "executor", thinkingLevel: "off" } });
	writeFileSync(`${packetPath}.claim`, JSON.stringify({ pid: 99999999, processStartedAt: "old", token: "dead-token", planId: "paused-recovery", sourceSessionId: "integration-session", claimedAt: "now" }), { mode: 0o600 });
	const root = "11111111-1111-4111-8111-111111111111";
	writeFileSync(`${packetPath}.reclaim`, JSON.stringify({ pid: 99999998, processStartedAt: "old", token: root, planId: "paused-recovery", sourceSessionId: "integration-session", deadClaimToken: "dead-token", reclaimedAt: "now" }), { mode: 0o600 });
	const h = await harness({ ...plan, handoffPath: packetPath, detachedHandoff: { handoffPath: packetPath, transferId: "detached", planId: "paused-recovery", source: { sessionId: "integration-session", cwd: agentDir, tmuxSession: "test" }, sourceLeafId: "integration-leaf", destination: "tmux-pane", launch: { cwd: agentDir, session: "test", window: "@1", pane: "%1" } }, recovery: { handoffPath: packetPath, token: root, planId: "paused-recovery", sourceSessionId: "integration-session" } });
	await h.commands.get("plan-recover").handler("", h.context);
	assert.equal(h.state.phase, "paused", h.notifications.join("; "));
	assert.equal(h.state.recovery, undefined);
	assert.equal(h.state.handoffPath, undefined);
	assert.equal(h.state.detachedHandoff, undefined);
	assert.equal(existsSync(packetPath), false);
	await h.handlers.get("session_shutdown")({}, h.context);
});

test("a reloaded child restores its persisted claim before explicitly starting execution", async () => {
	const plan = { ...createPlanState(), planId: "child-claim", createdAt: new Date().toISOString(), phase: "ready" as const, goal: "Execute", steps: [{ id: "one", step: 1, text: "Do it", completed: false, skipped: false }], executionBrief: brief, executionSource: { sessionId: "integration-session", cwd: agentDir, tmuxSession: "test" }, executionModel: { provider: "test", model: "executor", thinkingLevel: "off" as const } };
	const packetPath = writeExecutionPacket(agentDir, { version: 2, plan, source: { sessionId: "integration-session", cwd: agentDir, tmuxSession: "test" }, model: plan.executionModel });
	const packet = (await import("./execution-handoff.ts")).consumeExecutionPacket(agentDir, packetPath)!;
	const h = await harness({ ...plan, executionClaim: { path: packetPath, token: packet.claimToken } });
	await h.commands.get("plan-review").handler("", h.context);
	assert.equal(h.state.phase, "executing");
	assert.equal(h.state.executionClaim?.token, packet.claimToken);
	assert.equal(existsSync(packetPath), true);
	await h.handlers.get("session_shutdown")({}, h.context);
});

test("/read-only from an executing plan first pauses the plan", async () => {
	const h = await harness({ ...createPlanState(), phase: "executing", goal: "Goal", steps: [{ id: "one", step: 1, text: "Do it", completed: false, skipped: false }], executionBrief: brief });
	await h.commands.get("read-only").handler("", h.context);
	assert.equal(h.state.phase, "paused");
	assert.equal(h.state.accessMode, "read-only");
	assert.equal(h.active.includes("write"), false);
	await h.handlers.get("session_shutdown")({}, h.context);
});

test("registered tracked updates accept IDs while internal structured input is rejected", async () => {
	const h = await harness();
	await h.commands.get("plan").handler("", h.context);
	await h.tools.get("plan_update").execute("1", { goal: "Goal", steps: ["First", "Second"], executionBrief: brief }, undefined, undefined, h.context);
	const first = h.state.steps[0]!;
	await h.tools.get("plan_update").execute("2", { goal: "Goal", steps: [{ id: first.id, text: "Renamed" }, { text: "New" }], executionBrief: brief }, undefined, undefined, h.context);
	assert.equal(h.state.steps[0]!.id, first.id);
	await assert.rejects(() => h.tools.get("plan_update").execute("3", { scope: "internal", goal: "Internal", steps: [{ text: "No ID shape" }], executionBrief: brief }, undefined, undefined, h.context), /string steps/);
	await h.handlers.get("session_shutdown")({}, h.context);
});

test("agent_before_settle creates one closeout continuation per terminal epoch", async () => {
	const terminal = { ...createPlanState(), phase: "executing" as const, planId: "terminal", goal: "Goal", steps: [{ id: "one", step: 1, text: "Done", completed: true, skipped: false }], executionBrief: brief, terminalEpoch: 1 };
	const h = await harness({ ...terminal, closeoutState: { kind: "requested", planId: "terminal", terminalEpoch: 1, executionId: closeoutExecutionIdentity(terminal) } });
	assert.equal(h.state.closeoutState.kind, "attention", "reload never resumes a requested continuation");
	await h.commands.get("plan-review").handler("", h.context);
	assert.equal(h.state.closeoutState.kind, "requested");
	const event = { outcome: "completed", context: { canContinue: true, pendingMessages: [] }, entries: [], continue: false };
	const first = await h.handlers.get("agent_before_settle")(event, h.context);
	assert.equal(first?.continue, true);
	const second = await h.handlers.get("agent_before_settle")(event, h.context);
	assert.equal(second, undefined);
	assert.equal(h.state.closeoutState.kind, "started");
	await h.handlers.get("session_shutdown")({}, h.context);
});

test("a queued tool cannot mutate after branch navigation", async () => {
	const executing = { ...createPlanState(), phase: "executing" as const, goal: "Goal", steps: [{ id: "one", step: 1, text: "Do it", completed: false, skipped: false }], executionBrief: brief };
	const h = await harness(executing);
	const queued = h.tools.get("plan_step").execute("1", { action: "complete", step: 1 }, undefined, undefined, h.context);
	h.setLeaf("other-branch");
	await assert.rejects(queued, /superseded/);
	assert.equal(h.state.steps[0]!.completed, false);
	await h.handlers.get("session_shutdown")({}, h.context);
});

test("stale model completion cannot begin execution on a navigated branch", async () => {
	const revising = { ...createPlanState(), phase: "revising" as const, accessMode: "plan" as const, goal: "Goal", steps: [{ id: "one", step: 1, text: "Do it", completed: false, skipped: false }], executionBrief: brief, resumeAfterRevision: true, executionModel: { provider: "test", model: "executor", thinkingLevel: "off" as const } };
	const h = await harness(revising);
	h.holdModel();
	const update = h.tools.get("plan_update").execute("1", { goal: "Goal", steps: [{ id: "one", text: "Do it" }], executionBrief: brief }, undefined, undefined, h.context);
	await Promise.resolve();
	h.setLeaf("other-branch");
	h.releaseModel();
	await assert.rejects(update, /No valid execution model/);
	assert.equal(h.modelSet, false);
	assert.equal(h.state.phase, "revising");
	await h.handlers.get("session_shutdown")({}, h.context);
});

test("same-branch recalibration resumes with a post-update guard and execution model", async () => {
	const revising = { ...createPlanState(), phase: "revising" as const, accessMode: "plan" as const, goal: "Goal", steps: [{ id: "one", step: 1, text: "Do it", completed: false, skipped: false }], executionBrief: brief, resumeAfterRevision: true, executionModel: { provider: "test", model: "executor", thinkingLevel: "off" as const } };
	const h = await harness(revising);
	await h.tools.get("plan_update").execute("1", { goal: "Goal", steps: [{ id: "one", text: "Revised work" }], executionBrief: brief }, undefined, undefined, h.context);
	assert.equal(h.state.phase, "executing");
	assert.equal(h.state.accessMode, "none");
	assert.deepEqual(h.modelCalls, ["executor"]);
	assert.deepEqual(h.thinkingLevels, ["off"]);
	await h.handlers.get("session_shutdown")({}, h.context);
});

test("model restoration ignores Pi's default-thinking event before model_select", async () => {
	const revising = { ...createPlanState(), phase: "revising" as const, accessMode: "plan" as const, goal: "Goal", steps: [{ id: "one", step: 1, text: "Do it", completed: false, skipped: false }], executionBrief: brief, resumeAfterRevision: true, executionModel: { provider: "test", model: "executor", thinkingLevel: "high" as const } };
	const h = await harness(revising);
	h.emulateModelSwitch("minimal");
	await h.tools.get("plan_update").execute("1", { goal: "Goal", steps: [{ id: "one", text: "Do it" }], executionBrief: brief }, undefined, undefined, h.context);
	assert.deepEqual(h.modelCalls, ["executor"]);
	assert.equal(h.context.model.id, "executor");
	assert.equal(h.context.thinkingLevel, "high");
	assert.deepEqual(h.thinkingLevels, ["high"]);
	await h.handlers.get("session_shutdown")({}, h.context);
});

test("a manual same-target model and thinking selection wins over an authenticated internal mutation", async () => {
	const oldModel = { provider: "test", model: "old", thinkingLevel: "low" as const };
	const oldState = { ...createPlanState(), phase: "executing" as const, goal: "Old", steps: [{ id: "one", step: 1, text: "Do it", completed: false, skipped: false }], executionBrief: brief, executionModel: oldModel };
	const h = await harness();
	h.emulateModelSwitch("minimal");
	h.holdModel();
	h.setBranch([{ type: "custom", customType: "plan-mode", data: oldState }]);
	const restore = h.handlers.get("session_tree")({}, h.context);
	await Promise.resolve();
	// This runs in a separate task, outside the AsyncLocalStorage token used by
	// the queued effect. The mock setter emits exactly as Pi 0.99.2 does: model
	// default thinking first, followed by model_select in the same async chain.
	await h.userSelectModel("old", "high");
	h.releaseAllModels();
	await restore;
	while (h.modelCalls.length < 2 || h.context.thinkingLevel !== "high") await new Promise((resolve) => setTimeout(resolve, 1));
	assert.deepEqual(h.modelCalls, ["old", "old"]);
	assert.deepEqual(h.thinkingLevels, ["high"]);
	assert.equal(h.context.model.id, "old");
	assert.equal(h.context.thinkingLevel, "high");
	await h.handlers.get("session_shutdown")({}, h.context);
});

test("manual closeout retry gets no second automatic attempt after its turn starts", async () => {
	const terminal = { ...createPlanState(), phase: "executing" as const, planId: "bounded-retry", goal: "Goal", steps: [{ id: "one", step: 1, text: "Done", completed: true, skipped: false }], executionBrief: brief, terminalEpoch: 1 };
	const h = await harness({ ...terminal, closeoutState: { kind: "attention", planId: terminal.planId, terminalEpoch: 1, executionId: closeoutExecutionIdentity(terminal), reason: "missing-complete" } });
	await h.commands.get("plan-review").handler("", h.context);
	await h.handlers.get("before_agent_start")({ systemPrompt: "" }, h.context);
	assert.equal(h.state.closeoutState.kind, "started");
	assert.equal(await h.handlers.get("agent_before_settle")({ outcome: "completed", context: { canContinue: true, pendingMessages: [] }, entries: [], continue: false }, h.context), undefined);
	await h.handlers.get("agent_settled")({}, h.context);
	assert.equal(h.state.closeoutState.kind, "attention");
	await h.handlers.get("session_shutdown")({}, h.context);
});

test("manual closeout retry becomes attention when the attempt settles without plan_complete", async () => {
	const terminal = { ...createPlanState(), phase: "executing" as const, planId: "manual-retry", goal: "Goal", steps: [{ id: "one", step: 1, text: "Done", completed: true, skipped: false }], executionBrief: brief, terminalEpoch: 1 };
	const h = await harness({ ...terminal, closeoutState: { kind: "attention", planId: terminal.planId, terminalEpoch: 1, executionId: closeoutExecutionIdentity(terminal), reason: "missing-complete" } });
	await h.commands.get("plan-review").handler("", h.context);
	await h.handlers.get("before_agent_start")({ systemPrompt: "" }, h.context);
	await h.handlers.get("agent_settled")({}, h.context);
	assert.equal(h.state.closeoutState.kind, "attention");
	await h.handlers.get("session_shutdown")({}, h.context);
});

test("a non-continuable closeout request becomes visible attention", async () => {
	const terminal = { ...createPlanState(), phase: "executing" as const, planId: "terminal-attention", goal: "Goal", steps: [{ id: "one", step: 1, text: "Done", completed: true, skipped: false }], executionBrief: brief, terminalEpoch: 1 };
	const h = await harness({ ...terminal, closeoutState: { kind: "requested", planId: terminal.planId, terminalEpoch: 1, executionId: closeoutExecutionIdentity(terminal) } });
	assert.equal(h.state.closeoutState.kind, "attention");
	await h.commands.get("plan-review").handler("", h.context);
	const result = await h.handlers.get("agent_before_settle")({ outcome: "aborted", context: { canContinue: false, pendingMessages: [] }, entries: [], continue: false }, h.context);
	assert.equal(result, undefined);
	assert.equal(h.state.closeoutState.kind, "attention");
	await h.handlers.get("session_shutdown")({}, h.context);
});

test("startup and session-tree restore requested or started closeout as retryable attention", async () => {
	const terminal = { ...createPlanState(), phase: "executing" as const, planId: "restored-closeout", goal: "Goal", steps: [{ id: "one", step: 1, text: "Done", completed: true, skipped: false }], executionBrief: brief, terminalEpoch: 1 };
	const started = { ...terminal, closeoutState: { kind: "started" as const, planId: terminal.planId, terminalEpoch: 1, executionId: closeoutExecutionIdentity(terminal) } };
	const startup = await harness(started);
	assert.deepEqual(startup.state.closeoutState, { ...started.closeoutState, kind: "attention", reason: "restored" });
	const tree = await harness();
	tree.setBranch([{ type: "custom", customType: "plan-mode", data: started }]);
	await tree.handlers.get("session_tree")({}, tree.context);
	assert.deepEqual(tree.state.closeoutState, { ...started.closeoutState, kind: "attention", reason: "restored" });
	await startup.handlers.get("session_shutdown")({}, startup.context);
	await tree.handlers.get("session_shutdown")({}, tree.context);
});

test("a malformed state after a bootstrap transfer refuses handoff consumption", async () => {
	const plan = { ...createPlanState(), planId: "transfer-malformed", createdAt: new Date().toISOString(), phase: "ready" as const, goal: "Execute", steps: [{ id: "one", step: 1, text: "Do it", completed: false, skipped: false }], executionBrief: brief, executionSource: { sessionId: "integration-session", cwd: agentDir, tmuxSession: "test" }, executionModel: { provider: "test", model: "executor", thinkingLevel: "off" as const } };
	const packetPath = writeExecutionPacket(agentDir, { version: 2, plan, source: plan.executionSource, model: plan.executionModel });
	const transfer = { handoffPath: packetPath, transferId: "transfer", saveDefault: false, source: plan.executionSource, planId: plan.planId };
	const malformed = { ...plan, version: 7, steps: [{ ...plan.steps[0]! }, { ...plan.steps[0]!, step: 2 }] };
	const child = await harness();
	child.setBranch([{ type: "custom", customType: "plan-mode-new-session-execution", data: transfer }, { type: "custom", customType: "plan-mode", data: malformed }]);
	await child.handlers.get("session_tree")({}, child.context);
	await child.commands.get("plan-review").handler("", child.context);
	assert.match(child.notifications.at(-1) ?? "", /malformed/);
	assert.equal(executionOwner(agentDir, packetPath), "unknown");
	await child.handlers.get("session_shutdown")({}, child.context);
});

test("a newer plan state overrides bootstrap transfer on session-tree restoration", async () => {
	const plan = { ...createPlanState(), planId: "transfer-claim", createdAt: new Date().toISOString(), phase: "ready" as const, goal: "Execute", steps: [{ id: "one", step: 1, text: "Do it", completed: false, skipped: false }], executionBrief: brief, executionSource: { sessionId: "integration-session", cwd: agentDir, tmuxSession: "test" }, executionModel: { provider: "test", model: "executor", thinkingLevel: "off" as const } };
	const packetPath = writeExecutionPacket(agentDir, { version: 2, plan, source: plan.executionSource, model: plan.executionModel });
	const packet = (await import("./execution-handoff.ts")).consumeExecutionPacket(agentDir, packetPath)!;
	const child = await harness();
	const transfer = { handoffPath: packetPath, transferId: "transfer", saveDefault: false, source: plan.executionSource, planId: plan.planId };
	child.setBranch([{ type: "custom", customType: "plan-mode-new-session-execution", data: transfer }, { type: "custom", customType: "plan-mode", data: { ...plan, executionClaim: { path: packetPath, token: packet.claimToken } } }]);
	await child.handlers.get("session_tree")({}, child.context);
	assert.equal(child.state.executionClaim?.token, packet.claimToken);
	assert.equal(child.state.goal, "Execute");
	await child.handlers.get("session_shutdown")({}, child.context);
});

test("queued stale model effects cannot overwrite the restored branch model", async () => {
	const oldModel = { provider: "test", model: "old", thinkingLevel: "low" as const };
	const newModel = { provider: "test", model: "new", thinkingLevel: "high" as const };
	const oldState = { ...createPlanState(), phase: "executing" as const, goal: "Old", steps: [{ id: "one", step: 1, text: "Do it", completed: false, skipped: false }], executionBrief: brief, executionModel: oldModel };
	const newState = { ...oldState, goal: "New", executionModel: newModel };
	const h = await harness();
	h.holdModel();
	h.setBranch([{ type: "custom", customType: "plan-mode", data: oldState }]);
	const oldRestore = h.handlers.get("session_tree")({}, h.context);
	await Promise.resolve();
	h.setLeaf("other-branch");
	h.setBranch([{ type: "custom", customType: "plan-mode", data: newState }]);
	const newRestore = h.handlers.get("session_tree")({}, h.context);
	h.releaseModel();
	while (h.modelCalls.length < 1) await new Promise((resolve) => setTimeout(resolve, 1));
	h.releaseAllModels();
	await Promise.all([oldRestore, newRestore]);
	assert.deepEqual(h.modelCalls, ["old", "new"]);
	assert.deepEqual(h.thinkingLevels, ["high"]);
	await h.handlers.get("session_shutdown")({}, h.context);
});

test("a user thinking selection remains the latest destination after a stale deferred mutation", async () => {
	const oldModel = { provider: "test", model: "old", thinkingLevel: "low" as const };
	const oldState = { ...createPlanState(), phase: "executing" as const, goal: "Old", steps: [{ id: "one", step: 1, text: "Do it", completed: false, skipped: false }], executionBrief: brief, executionModel: oldModel };
	const h = await harness();
	h.emulateModelSwitch("minimal");
	h.holdModel();
	h.setBranch([{ type: "custom", customType: "plan-mode", data: oldState }]);
	const restore = h.handlers.get("session_tree")({}, h.context);
	await Promise.resolve();
	h.context.thinkingLevel = "high";
	await h.handlers.get("thinking_level_select")({ thinkingLevel: "high" }, h.context);
	h.releaseAllModels();
	await restore;
	assert.equal(h.context.thinkingLevel, "high");
	assert.equal(h.thinkingLevels.includes("low"), false);
	await h.handlers.get("session_shutdown")({}, h.context);
});

test("a user model selection remains the latest destination after a stale deferred mutation", async () => {
	const oldModel = { provider: "test", model: "old", thinkingLevel: "low" as const };
	const oldState = { ...createPlanState(), phase: "executing" as const, goal: "Old", steps: [{ id: "one", step: 1, text: "Do it", completed: false, skipped: false }], executionBrief: brief, executionModel: oldModel };
	const h = await harness();
	h.holdModel();
	h.setBranch([{ type: "custom", customType: "plan-mode", data: oldState }]);
	const restore = h.handlers.get("session_tree")({}, h.context);
	await Promise.resolve();
	h.context.model = { provider: "test", id: "user-choice" };
	h.context.thinkingLevel = "high";
	await h.handlers.get("model_select")({ model: h.context.model }, h.context);
	h.releaseAllModels();
	await restore;
	while (h.context.model.id !== "user-choice") await new Promise((resolve) => setTimeout(resolve, 1));
	assert.equal(h.context.model.id, "user-choice");
	assert.equal(h.context.thinkingLevel, "high");
	await h.handlers.get("session_shutdown")({}, h.context);
});

test("a stale deferred model mutation is corrected to the planless destination model", async () => {
	const oldModel = { provider: "test", model: "old", thinkingLevel: "low" as const };
	const oldState = { ...createPlanState(), phase: "executing" as const, goal: "Old", steps: [{ id: "one", step: 1, text: "Do it", completed: false, skipped: false }], executionBrief: brief, executionModel: oldModel };
	const h = await harness();
	h.holdModel();
	h.setBranch([{ type: "custom", customType: "plan-mode", data: oldState }]);
	const oldRestore = h.handlers.get("session_tree")({}, h.context);
	await Promise.resolve();
	h.setLeaf("planless-branch");
	h.context.model = { provider: "test", id: "native-new" };
	h.context.thinkingLevel = "high";
	h.setBranch([{ type: "custom", customType: "plan-mode", data: createPlanState() }]);
	const planlessRestore = h.handlers.get("session_tree")({}, h.context);
	h.releaseModel();
	while (h.modelCalls.length < 1) await new Promise((resolve) => setTimeout(resolve, 1));
	h.releaseAllModels();
	await Promise.all([oldRestore, planlessRestore]);
	assert.equal(h.context.model.id, "native-new");
	assert.equal(h.context.thinkingLevel, "high");
	await h.handlers.get("session_shutdown")({}, h.context);
});

test("malformed v6 current plan state is refused instead of restoring execution", async () => {
	const malformed = { ...createPlanState(), version: 6 as const, phase: "executing" as const, goal: "Malformed", steps: [{ id: "dup", step: 1, text: "One", completed: false, skipped: false }, { id: "dup", step: 2, text: "Two", completed: false, skipped: false }], executionBrief: brief };
	const h = await harness();
	h.setBranch([{ type: "custom", customType: "plan-mode", data: malformed }]);
	await h.handlers.get("session_tree")({}, h.context);
	assert.equal(h.active.includes("plan_step"), false);
	await h.commands.get("plan-review").handler("", h.context);
	assert.match(h.notifications.at(-1) ?? "", /malformed/);
	await h.handlers.get("session_shutdown")({}, h.context);
});

test("invalid restored child claim becomes ownership attention without execution controls", async () => {
	const claimed = { ...createPlanState(), planId: "claimed", createdAt: new Date().toISOString(), phase: "executing" as const, goal: "Claimed", steps: [{ id: "one", step: 1, text: "Do it", completed: false, skipped: false }], executionBrief: brief, executionSource: { sessionId: "source-session", cwd: agentDir, tmuxSession: "work" }, executionModel: { provider: "test", model: "executor", thinkingLevel: "off" as const }, executionClaim: { path: "/not-a-private-handoff", token: "stale" } };
	const h = await harness(claimed);
	assert.equal(h.active.includes("plan_step"), false);
	await assert.rejects(() => h.tools.get("plan_step").execute("1", { action: "complete", step: 1 }, undefined, undefined, h.context), /only while executing/);
	await h.commands.get("plan-review").handler("", h.context);
	assert.match(h.notifications.at(-1) ?? "", /source session/);
	await h.handlers.get("session_shutdown")({}, h.context);
});

test("child session startup claims, acknowledges, and kicks off a detached launch during source navigation", async () => {
	const previousHandoff = process.env.PI_PLAN_HANDOFF;
	const previousTmux = process.env.TMUX;
	const previousPane = process.env.TMUX_PANE;
	process.env.TMUX = "socket,1,0";
	process.env.TMUX_PANE = "%1";
	try {
		const source = await harness();
		source.context.ui.select = async () => "Execute";
		source.setExecutionSettings({ destination: "tmux-pane", modelPolicy: "current", paneDirection: "below", saveDefault: false });
		await source.commands.get("plan").handler("", source.context);
		await source.tools.get("plan_update").execute("1", { goal: "Detach", steps: ["Do it"], executionBrief: brief }, undefined, undefined, source.context);
		source.holdTmuxLaunch();
		const launch = source.commands.get("plan-review").handler("", source.context);
		while (!source.execCalls.some((call: string[]) => call[1] === "split-window")) await new Promise((resolve) => setTimeout(resolve, 1));
		const packetPath = source.state.handoffPath!;
		process.env.PI_PLAN_HANDOFF = packetPath;
		const child = await harness();
		assert.equal(child.state.phase, "executing");
		assert.equal(child.state.executionClaim?.path, packetPath);
		assert.equal(executionOwner(agentDir, packetPath), "ready");
		assert.ok(child.messages.some(({ message }) => message.customType === "plan-execution-kickoff"));
		source.setLeaf("other-branch");
		await source.handlers.get("session_tree")({}, source.context);
		source.releaseTmuxLaunch();
		await launch;
		assert.equal(child.state.executionClaim?.path, packetPath);
		await child.handlers.get("session_shutdown")({}, child.context);
		await source.handlers.get("session_shutdown")({}, source.context);
	} finally {
		if (previousHandoff === undefined) delete process.env.PI_PLAN_HANDOFF; else process.env.PI_PLAN_HANDOFF = previousHandoff;
		if (previousTmux === undefined) delete process.env.TMUX; else process.env.TMUX = previousTmux;
		if (previousPane === undefined) delete process.env.TMUX_PANE; else process.env.TMUX_PANE = previousPane;
	}
});

test("detached launch persists source ownership before tmux settles and survives navigation", async () => {
	const previousTmux = process.env.TMUX;
	const previousPane = process.env.TMUX_PANE;
	process.env.TMUX = "socket,1,0";
	process.env.TMUX_PANE = "%1";
	try {
		const h = await harness();
		h.context.ui.select = async () => "Execute";
		h.setExecutionSettings({ destination: "tmux-pane", modelPolicy: "current", paneDirection: "below", saveDefault: false });
		await h.commands.get("plan").handler("", h.context);
		await h.tools.get("plan_update").execute("1", { goal: "Detach", steps: ["Do it"], executionBrief: brief }, undefined, undefined, h.context);
		h.holdTmuxLaunch();
		const review = h.commands.get("plan-review").handler("", h.context);
		while (!h.execCalls.some((call: string[]) => call[1] === "split-window")) await new Promise((resolve) => setTimeout(resolve, 1));
		const packetPath = h.state.handoffPath!;
		assert.equal(h.state.phase, "handed-off");
		assert.equal(h.state.detachedHandoff?.handoffPath, packetPath);
		const packet = (await import("./execution-handoff.ts")).consumeExecutionPacket(agentDir, packetPath);
		assert.ok(packet);
		h.setLeaf("other-branch");
		await h.handlers.get("session_tree")({}, h.context);
		h.releaseTmuxLaunch();
		await review;
		assert.equal(h.state.phase, "handed-off");
		assert.equal(existsSync(packetPath), true);
		await h.handlers.get("session_shutdown")({}, h.context);
	} finally {
		if (previousTmux === undefined) delete process.env.TMUX; else process.env.TMUX = previousTmux;
		if (previousPane === undefined) delete process.env.TMUX_PANE; else process.env.TMUX_PANE = previousPane;
	}
});

// Test state is isolated; no live Pi agent directory is touched.
process.on("exit", () => rmSync(agentDir, { recursive: true, force: true }));
