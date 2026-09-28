import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createPlanState } from "./plan-state.ts";
import { livePlanPath, publishLivePlan, removeLivePlan } from "./live-plan.ts";

function plan() {
	return {
		...createPlanState(),
		phase: "executing" as const,
		goal: "Unify agent actions",
		steps: [{ id: "s1", step: 1, text: "Wire plan opener", completed: false, skipped: false }],
		criteria: ["Identity is exact"],
		followUps: ["Activate Nix"],
		executionBrief: {
			summary: "Expose the current tracked plan.",
			findings: ["Checklist sidecars are insufficient."],
			decisions: ["Publish a PID-keyed snapshot."],
			relevantFiles: [{ path: "tmux.conf", note: "Shortcut boundary" }],
			constraints: ["Never publish internal plans."],
		},
	};
}

test("publishes a private identity-bound full tracked plan", () => {
	const dir = mkdtempSync(join(tmpdir(), "pi-live-plan-"));
	process.env.PI_PLAN_STATE_DIR = dir;
	publishLivePlan({ pid: 4242, sessionId: "session-a", sessionFile: "/sessions/a.jsonl", cwd: "/repo", processStartedAt: "Mon Jan 1 00:00:00 2024" }, plan());
	const path = livePlanPath(4242);
	const record = JSON.parse(readFileSync(path, "utf8"));
	assert.equal(statSync(path).mode & 0o777, 0o600);
	assert.equal(record.sessionId, "session-a");
	assert.equal(record.processStartedAt, "Mon Jan 1 00:00:00 2024");
	assert.match(record.markdown, /Unify agent actions/);
	assert.match(record.markdown, /Identity is exact/);
	assert.match(record.markdown, /PID-keyed snapshot/);
	assert.match(record.markdown, /`tmux\.conf`/);
});

test("guarded cleanup preserves replacements while an empty current plan clears crash residue", () => {
	const dir = mkdtempSync(join(tmpdir(), "pi-live-plan-"));
	process.env.PI_PLAN_STATE_DIR = dir;
	publishLivePlan({ pid: 4243, sessionId: "session-a", cwd: "/repo", processStartedAt: "Mon Jan 1 00:00:00 2024" }, plan());
	removeLivePlan(4243, "other-session");
	assert.doesNotThrow(() => readFileSync(livePlanPath(4243)));
	publishLivePlan({ pid: 4243, sessionId: "session-b", cwd: "/repo", processStartedAt: "Mon Jan 1 00:00:01 2024" }, createPlanState());
	assert.throws(() => readFileSync(livePlanPath(4243)));
});
