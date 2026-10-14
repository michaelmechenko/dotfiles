import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import test from "node:test";
import { root } from "../test-runtime.mjs";
import { createPlanState, migratePlanState } from "./plan-state.ts";

const agentDir = mkdtempSync(resolve(tmpdir(), "pi-pending-continuation-"));
process.env.PI_CODING_AGENT_DIR = agentDir;
const require = createRequire(resolve(root!, "dist/index.js"));
// This authored-only workspace omits the tmux extension. Execution handoff is
// not exercised here, so give Jiti the two pure runtime exports it imports.
const tmuxRuntime = {
	splitDirectionArgs: (direction: "below" | "right") => direction === "right" ? "-h" : "-v",
	spawnedPiCommand: (command: string) => command,
};
const { createJiti } = await import(pathToFileURL(resolve(root!, "node_modules/jiti/lib/jiti.mjs")).href);
const jiti = createJiti(import.meta.url, {
	fsCache: false,
	moduleCache: false,
	alias: {
		"@earendil-works/pi-coding-agent": resolve(root!, "dist/index.js"),
		"@earendil-works/pi-ai": resolve(root!, "node_modules/@earendil-works/pi-ai/dist/compat.js"),
		"@earendil-works/pi-agent-core": resolve(root!, "node_modules/@earendil-works/pi-agent-core/dist/index.js"),
		"@earendil-works/pi-tui": require.resolve("@earendil-works/pi-tui"),
		typebox: require.resolve("typebox"),
	},
	virtualModules: { "../tmux/runtime.ts": tmuxRuntime },
});
const { default: register } = await jiti.import(resolve(import.meta.dirname, "index.ts"));

const brief = { summary: "Continue authorized work", findings: [], decisions: [], relevantFiles: [], constraints: [] };
type Outcome = "completed" | "aborted" | "error";

function running(extra: Record<string, unknown> = {}) {
	return {
		...createPlanState(),
		planId: "pending-plan",
		phase: "executing" as const,
		goal: "Ship",
		steps: [
			{ id: "diagnose", step: 1, text: "Diagnose", completed: false, skipped: false },
			{ id: "verify", step: 2, text: "Verify", completed: false, skipped: false },
		],
		executionBrief: brief,
		executionId: "execution-1",
		...extra,
	};
}

async function harness(initial: Record<string, unknown> = running()) {
	const handlers = new Map<string, Array<(event: any, ctx: any) => any>>();
	const tools = new Map<string, any>();
	const commands = new Map<string, any>();
	const entries: any[] = [{ type: "custom", id: "root", customType: "plan-mode", data: initial }];
	const dialogs: string[] = [];
	const sent: Array<{ message: any; options: any }> = [];
	const notifications: string[] = [];
	let active = ["read", "write", "bash", "plan_update", "plan_step", "plan_complete"];
	let busy = false;
	let sequence = 0;
	let selection: string | undefined;
	const context: any = {
		cwd: agentDir,
		mode: "tui",
		hasUI: true,
		isIdle: () => !busy,
		scopedModels: [],
		sessionManager: {
			getSessionId: () => "pending-session",
			getSessionFile: () => undefined,
			getLeafId: () => entries.at(-1)?.id ?? "root",
			getBranch: () => entries,
		},
		ui: {
			theme: { fg: (_tone: string, text: string) => text, strikethrough: (text: string) => text },
			setStatus() {}, setWidget() {}, notify: (message: string) => notifications.push(message),
			select: async (title: string) => { dialogs.push(title); return selection; },
			confirm: async () => false,
		},
	};
	const pi: any = {
		registerCommand: (name: string, value: any) => commands.set(name, value),
		registerTool: (value: any) => tools.set(value.name, value),
		registerShortcut() {}, registerFlag() {},
		on: (name: string, handler: any) => handlers.set(name, [...(handlers.get(name) ?? []), handler]),
		events: { on() {} },
		getActiveTools: () => active,
		getAllTools: () => active.map((name) => ({ name })),
		setActiveTools: (names: string[]) => { active = names; },
		appendEntry: (type: string, data: any) => entries.push({ type: "custom", id: `state-${++sequence}`, customType: type, data }),
		sendMessage: (message: any, options: any) => sent.push({ message, options }),
		sendUserMessage() {}, getFlag: () => false,
	};
	register(pi);
	async function emit(name: string, event: any = {}) {
		let current = event;
		for (const handler of handlers.get(name) ?? []) {
			const result = await handler(current, context);
			if (result) current = { ...current, ...result };
		}
		return current;
	}
	await emit("session_start", { reason: "startup" });
	return {
		context, commands, dialogs, entries, notifications, sent, tools, emit,
		get state() { return [...entries].reverse().find((entry) => entry.type === "custom" && entry.customType === "plan-mode")!.data; },
		set busy(value: boolean) { busy = value; },
		choose(value: string | undefined) { selection = value; },
		progress(id: string, isError = false) { entries.push({ type: "message", id, message: { role: "toolResult", toolName: "bash", toolCallId: id, isError, content: [{ type: "text", text: isError ? "failed ordinary tool" : "ordinary milestone" }] } }); },
		assistant(stopReason = "stop") { entries.push({ type: "message", id: `assistant-${++sequence}`, message: { role: "assistant", timestamp: sequence, stopReason, content: [{ type: "text", text: "stopped" }] } }); },
	};
}

function settle(outcome: Outcome = "completed", pendingMessages: unknown[] = []) {
	return { outcome, continue: false, entries: [], context: { canContinue: true, pendingMessages } };
}
async function update(h: Awaited<ReturnType<typeof harness>>, payload: Record<string, unknown>) {
	return h.tools.get("plan_update").execute("update", { goal: "Ship", steps: ["Diagnose", "Verify"], executionBrief: brief, ...payload }, undefined, undefined, h.context);
}
async function close(h: Awaited<ReturnType<typeof harness>>) { await h.emit("session_shutdown", {}); }

test("registered plan_update persists input and permission waits and clears only on tracked updates", async () => {
	const h = await harness();
	assert.ok("executionWait" in h.tools.get("plan_update").parameters.properties, "registered plan_update accepts executionWait");
	assert.match(JSON.stringify(h.tools.get("plan_update").parameters.properties.executionWait), /permission/, "TypeBox schema includes permission waits");
	for (const kind of ["input", "permission"] as const) {
		const wait = { kind, reason: `Need ${kind} approval` };
		await update(h, { executionWait: wait });
		assert.deepEqual(h.state.continuation.waitFor, wait);
		assert.deepEqual(migratePlanState(JSON.parse(JSON.stringify(h.state)))?.continuation.waitFor, wait, "reload preserves structured waits");
		assert.equal((await h.emit("agent_before_settle", settle())).continue, false);
		await update(h, { executionWait: null });
		assert.equal(h.state.continuation.waitFor, undefined);
	}
	await assert.rejects(() => update(h, { scope: "internal", executionWait: null }), /executionWait.*tracked/i);
	await assert.rejects(() => update(h, { executionWait: { kind: "unknown", reason: "invalid" } }), /executionWait.*supported/i);
	await assert.rejects(() => update(h, { executionWait: { kind: "input", reason: "   " } }), /executionWait.*nonblank/i);
	await close(h);
});

test("failed ordinary tools and ordinary milestone stops get one continuation without a Resume dialog", async () => {
	for (const failed of [false, true]) {
		const h = await harness();
		h.progress(failed ? "failed-tool" : "completed-tool", failed);
		const first = await h.emit("agent_before_settle", settle());
		assert.equal(first.continue, true, failed ? "failed ordinary tool is recoverable pending work" : "completed milestone retains pending work");
		assert.equal(h.state.continuation.used, 1);
		assert.deepEqual(h.dialogs, [], "a requested continuation never opens the routine Resume dialog");
		assert.equal((await h.emit("agent_before_settle", settle())).continue, false, "one checkpoint receives one rescue");
		assert.equal(h.state.continuation.waitFor?.kind, "external", "an unchanged checkpoint becomes an explicit no-progress wait");
		await close(h);
	}
});

test("verified milestones advance the checkpoint without requiring another ordinary tool", async () => {
	const h = await harness();
	h.progress("work-before-milestone");
	assert.equal((await h.emit("agent_before_settle", settle())).continue, true);
	await h.tools.get("plan_step").execute("step-1", { action: "complete", step: 1 }, undefined, undefined, h.context);
	assert.equal((await h.emit("agent_before_settle", settle())).continue, true, "next pending step is genuine progress, not a repeated checkpoint");
	assert.equal(h.state.continuation.used, 2);
	assert.equal(h.state.continuation.waitFor, undefined);
	await close(h);
});

test("approved execution start receives one rescue without invented tool progress", async () => {
	const h = await harness();
	assert.equal((await h.emit("agent_before_settle", settle())).continue, true);
	assert.equal((await h.emit("agent_before_settle", settle())).continue, false);
	assert.equal(h.state.continuation.used, 1);
	assert.equal(h.state.continuation.waitFor?.kind, "external");
	await close(h);
});

test("noncompleted boundaries, stopped assistants, queued input, paused modes, and ownership loss suppress rescue", async () => {
	for (const outcome of ["aborted", "error"] as const) {
		const h = await harness(); h.progress(`prior-completed-${outcome}`); h.assistant("stop");
		assert.equal((await h.emit("agent_before_settle", settle(outcome))).continue, false, `${outcome} boundary cannot reuse a completed prior transcript`);
		assert.equal(h.state.continuation.used, 0); await close(h);
	}
	for (const stopReason of ["aborted", "error", "pending", "deferred"]) {
		const h = await harness(); h.progress(`stopped-${stopReason}`); h.assistant(stopReason);
		assert.equal((await h.emit("agent_before_settle", settle("completed"))).continue, false, stopReason);
		assert.equal(h.state.continuation.used, 0); await close(h);
	}
	const queued = await harness(); queued.progress("queued");
	assert.equal((await queued.emit("agent_before_settle", settle("completed", [{}]))).continue, false); await close(queued);
	for (const command of ["pause", "read-only", "plan"] as const) {
		const h = await harness(); h.progress(command);
		await h.commands.get(command).handler("", h.context);
		assert.equal((await h.emit("agent_before_settle", settle())).continue, false, command);
		await close(h);
	}
	const unowned = await harness(running({ ownershipAttention: { reason: "invalid-claim" } })); unowned.progress("ownership");
	assert.equal((await unowned.emit("agent_before_settle", settle())).continue, false); await close(unowned);
});

test("persisted waits suppress automatic resume dialogs after restore or branch activation", async () => {
	for (const kind of ["input", "permission"] as const) {
		const h = await harness(running({ continuation: { used: 2, waitFor: { kind, reason: `Need ${kind} approval` } } }));
		h.assistant();
		await h.emit("session_tree", {});
		await h.emit("agent_settled", {});
		assert.deepEqual(h.dialogs, [], `${kind} wait suppresses automatic dialogs after restore/navigation`);
		assert.equal(h.sent.some(({ message }) => message.customType === "plan-resume"), false, `${kind} wait sends no automatic resume message`);
		await h.commands.get("plan-review").handler("", h.context);
		assert.ok(h.dialogs.includes("Current plan"), "/plan-review remains an explicit manual control");
		await close(h);
	}
});

test("checkpoint duplicates wait rather than loop, while 32 persisted rescues survive update and reload", async () => {
	const h = await harness(running({ continuation: { used: 31, lastCheckpoint: "tool-31" } }));
	h.progress("tool-32");
	assert.equal((await h.emit("agent_before_settle", settle())).continue, true);
	assert.equal(h.state.continuation.used, 32);
	await update(h, { executionWait: null });
	assert.equal(h.state.continuation.used, 32, "plan_update cannot replenish rescue allowance");
	const restored = migratePlanState(JSON.parse(JSON.stringify(h.state)))!;
	assert.equal((restored as any).continuation.used, 32, "reload migration preserves the exhausted allowance");
	assert.equal((await h.emit("agent_before_settle", settle())).continue, false);
	assert.equal(h.state.continuation.waitFor?.kind, "budget");
	await close(h);
});

test("failure recovery advances through the next step and leaves terminal closeout independent", async () => {
	const h = await harness();
	h.progress("failed-tool", true);
	assert.equal((await h.emit("agent_before_settle", settle())).continue, true);
	await h.tools.get("plan_step").execute("step-1", { action: "complete", step: 1 }, undefined, undefined, h.context);
	h.progress("fixed-tool");
	assert.equal((await h.emit("agent_before_settle", settle())).continue, true);
	await h.tools.get("plan_step").execute("step-2", { action: "complete", step: 2 }, undefined, undefined, h.context);
	assert.equal(h.state.continuation.used, 2);
	assert.equal((await h.emit("agent_before_settle", settle())).continue, true, "terminal closeout retains its separate continuation");
	assert.equal(h.state.continuation.used, 2, "terminal closeout does not consume rescue budget");
	await close(h);
});

test("terminal closeout never overrides a persisted legitimate execution wait", async () => {
	for (const kind of ["input", "permission", "external", "budget"] as const) {
		const h = await harness(running({
			steps: [{ id: "done", step: 1, text: "Done", completed: true, skipped: false }],
			terminalEpoch: 1,
			closeoutState: { kind: "requested", planId: "pending-plan", terminalEpoch: 1, executionId: "execution-1" },
			continuation: { used: 7, waitFor: { kind, reason: "Unresolved legitimate wait" } },
		}));
		await h.commands.get("plan-review").handler("", h.context);
		assert.equal(h.sent.some(({ message }) => message.customType === "plan-closeout-retry"), false, `${kind} wait cannot schedule a retry turn`);
		const status = h.state.closeoutState.kind;
		await h.emit("before_agent_start", { systemPrompt: "base" });
		assert.equal(h.state.closeoutState.kind, status, `${kind} wait does not start closeout`);
		assert.equal((await h.emit("agent_before_settle", settle())).continue, false, `${kind} wait prevents automatic closeout`);
		await assert.rejects(() => h.tools.get("plan_complete").execute("blocked-close", { outcome: "done", endState: "done", verification: ["mock"] }, undefined, undefined, h.context), /executionWait/);
		assert.equal(h.state.continuation.used, 7);
		await update(h, { steps: [{ id: "done", text: "Done" }], executionWait: null });
		await h.commands.get("plan-review").handler("", h.context);
		assert.equal(h.sent.some(({ message }) => message.customType === "plan-closeout-retry"), true, "clearing the wait permits explicit retry");
		await close(h);
	}
});

test("legacy migration initializes a fresh rescue allowance without changing terminal closeout", () => {
	const legacy = migratePlanState({ ...running(), version: 6, terminalEpoch: 3, closeoutState: { kind: "requested", planId: "pending-plan", terminalEpoch: 3, executionId: "execution-1" } })!;
	assert.deepEqual((legacy as any).continuation, { used: 0 });
	assert.deepEqual(legacy.closeoutState, { kind: "requested", planId: "pending-plan", terminalEpoch: 3, executionId: "execution-1" });
});

test("only a cleared wait and explicit Resume reset exhausted rescue state; terminal closeout is independent", async () => {
	const h = await harness(running({ continuation: { used: 32, lastCheckpoint: "exhausted", waitFor: { kind: "budget", reason: "limit" } } }));
	await update(h, { executionWait: null });
	h.progress("after-limit"); h.assistant(); h.choose("Resume current step");
	await h.emit("agent_settled", {});
	assert.equal(h.state.continuation.used, 0);
	assert.equal(h.state.continuation.waitFor, undefined);
	await close(h);

	const terminal = running({
		steps: [{ id: "done", step: 1, text: "Done", completed: true, skipped: false }],
		terminalEpoch: 1,
		closeoutState: { kind: "requested", planId: "pending-plan", terminalEpoch: 1, executionId: "execution-1" },
		continuation: { used: 7, lastCheckpoint: "ordinary-tool" },
	});
	const closed = await harness(terminal);
	await closed.commands.get("plan-review").handler("", closed.context);
	assert.equal((await closed.emit("agent_before_settle", settle())).continue, true, "terminal closeout keeps its existing continuation path");
	assert.equal(closed.state.continuation.used, 7, "terminal closeout never consumes pending-work rescue allowance");
	await close(closed);
});

process.on("exit", () => rmSync(agentDir, { recursive: true, force: true }));
