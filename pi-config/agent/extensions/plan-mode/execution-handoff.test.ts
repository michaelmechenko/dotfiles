import assert from "node:assert/strict";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { buildTmuxNewWindowArgs, consumeExecutionPacket, deleteExecutionPacket, renderPlanMarkdown, writeExecutionPacket } from "./execution-handoff.ts";
import { applyPlanUpdate, createPlanState } from "./plan-state.ts";

const model = { provider: "test", model: "model", thinkingLevel: "medium" as const };

test("plan handoff round-trips once and deletes its private file", () => {
	const dir = mkdtempSync(join(tmpdir(), "plan-mode-handoff-"));
	try {
		const plan = applyPlanUpdate(createPlanState(), { goal: "Ship", steps: ["Inspect", "Verify"], criteria: ["Tests pass"] });
		const markdown = renderPlanMarkdown(plan);
		assert.match(markdown, /# Plan/);
		const path = writeExecutionPacket(dir, { version: 1, plan, markdown, source: { sessionId: "id", cwd: "/tmp/project", tmuxSession: "work" }, model });
		assert.equal(consumeExecutionPacket(dir, path)?.source.tmuxSession, "work");
		assert.equal(consumeExecutionPacket(dir, path), undefined);
		const failedLaunch = writeExecutionPacket(dir, { version: 1, plan, markdown, source: { sessionId: "id", cwd: "/tmp/project", tmuxSession: "work" }, model });
		deleteExecutionPacket(dir, failedLaunch);
		assert.equal(existsSync(failedLaunch), false);
	} finally { rmSync(dir, { recursive: true, force: true }); }
});

test("tmux argv preserves cwd and passes no plan text through the shell", () => {
	const args = buildTmuxNewWindowArgs("work", "/tmp/project", "/tmp/handoff.json", model);
	assert.deepEqual(args.slice(0, 5), ["new-window", "-t", "work", "-c", "/tmp/project"]);
	assert.ok(args.includes("PI_PLAN_HANDOFF=/tmp/handoff.json"));
	assert.match(args.at(-1) ?? "", /^pi --provider/);
	assert.doesNotMatch(args.join(" "), /# Plan/);
});
