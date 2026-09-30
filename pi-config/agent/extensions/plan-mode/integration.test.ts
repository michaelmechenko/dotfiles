import assert from "node:assert/strict";
import { resolve } from "node:path";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import test from "node:test";
import { jiti } from "../test-runtime.mjs";
import { createPlanState } from "./plan-state.ts";
import { writeExecutionPacket } from "./execution-handoff.ts";
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
	const context: any = {
		cwd: agentDir, mode: "tui", isIdle: () => !busy,
		sessionManager: { getSessionId: () => "integration-session", getSessionFile: () => undefined, getBranch: () => entries },
		ui: { theme: { fg: (_: string, text: string) => text }, setStatus() {}, setWidget() {}, notify: (message: string) => notifications.push(message), select: async () => "Discard plan", editor: async () => "1. Modified", confirm: async () => true },
	};
	const pi: any = { registerCommand: (name: string, value: any) => commands.set(name, value), registerTool: (value: any) => tools.set(value.name, value), registerShortcut() {}, registerFlag() {}, on: (name: string, value: any) => handlers.set(name, value), events: { on() {} }, getActiveTools: () => active, getAllTools: () => active.map((name) => ({ name })), setActiveTools: (value: string[]) => { active = value; }, appendEntry: (_: string, data: any) => entries.push({ type: "custom", customType: "plan-mode", data }), sendMessage() {}, getFlag: () => false };
	register(pi);
	await handlers.get("session_start")({ reason: "startup" }, context);
	return { commands, tools, handlers, context, notifications, get active() { return active; }, set busy(value: boolean) { busy = value; }, get state() { return entries.at(-1)!.data; } };
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
	const plan = { ...createPlanState(), planId: "recovery-test", createdAt: new Date().toISOString(), phase: "handed-off" as const, goal: "Recover", steps: [{ id: "one", step: 1, text: "Check work", completed: false, skipped: false }], executionBrief: brief };
	const packetPath = writeExecutionPacket(agentDir, { version: 2, plan, source: { sessionId: "integration-session", cwd: agentDir, tmuxSession: "test" }, model: { provider: "test", model: "executor", thinkingLevel: "off" } });
	writeFileSync(`${packetPath}.claim`, JSON.stringify({ pid: 99999999, processStartedAt: "old" }), { mode: 0o600 });
	const h = await harness({ ...plan, handoffPath: packetPath });
	await h.commands.get("plan-recover").handler("", h.context);
	assert.equal(h.state.phase, "paused", h.notifications.join("; "));
	assert.equal(existsSync(packetPath), false);
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

// Test state is isolated; no live Pi agent directory is touched.
process.on("exit", () => rmSync(agentDir, { recursive: true, force: true }));
