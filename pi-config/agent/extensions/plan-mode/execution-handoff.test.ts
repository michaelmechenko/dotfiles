import assert from "node:assert/strict";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { buildTmuxDetachedPaneArgs, buildTmuxNewWindowArgs, consumeExecutionPacket, deleteExecutionPacket, renderPlanMarkdown, writeExecutionPacket } from "./execution-handoff.ts";
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

test("detached tmux argv preserves cwd, source focus, and no plan text", () => {
	const target = { session: "work", window: "@4", pane: "%9" };
	const windowArgs = buildTmuxNewWindowArgs(target, "/tmp/project", "/tmp/handoff.json", model);
	const paneArgs = buildTmuxDetachedPaneArgs(target, "/tmp/project", "/tmp/handoff.json", model);
	assert.deepEqual(windowArgs.slice(0, 6), ["new-window", "-d", "-t", "work", "-c", "/tmp/project"]);
	assert.deepEqual(paneArgs.slice(0, 7), ["split-window", "-d", "-h", "-t", "@4", "-c", "/tmp/project"]);
	for (const args of [windowArgs, paneArgs]) {
		assert.ok(args.includes("PI_PLAN_HANDOFF=/tmp/handoff.json"));
		assert.match(args.at(-1) ?? "", /^pi --provider/);
		assert.doesNotMatch(args.join(" "), /# Plan/);
	}
});
