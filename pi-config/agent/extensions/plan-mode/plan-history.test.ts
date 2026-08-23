import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { archiveCompletedPlan, completedPlanRecord, listCompletedPlans, planHistoryKey } from "./plan-history.ts";
import { applyPlanUpdate, createPlanState, materializePlan } from "./plan-state.ts";

const brief = { summary: "summary", findings: ["finding"], decisions: ["decision"], relevantFiles: [{ path: "index.ts", note: "flow" }], constraints: ["safe"] };
const closeout = { goal: "Ship", outcome: "done", endState: "complete", verification: ["tests"], deviations: [], nextSteps: [] };
const project = { kind: "git" as const, id: "/repo/.git" };

function completedState(id: string) {
	const state = materializePlan(applyPlanUpdate(createPlanState(), { goal: "Ship", steps: ["Implement"], executionBrief: brief }), "2026-01-01T00:00:00.000Z");
	return { ...state, planId: id, createdAt: "2026-01-01T00:00:00.000Z", phase: "executing" as const };
}

test("completed plans archive atomically and retain sequential session history", () => {
	const dir = mkdtempSync(join(tmpdir(), "plan-history-"));
	try {
		const first = completedPlanRecord(completedState("first"), "session-a", project, closeout, "2026-01-02T00:00:00.000Z");
		const second = completedPlanRecord(completedState("second"), "session-a", project, closeout, "2026-01-03T00:00:00.000Z");
		archiveCompletedPlan(dir, first);
		archiveCompletedPlan(dir, first);
		archiveCompletedPlan(dir, second);
		assert.deepEqual(listCompletedPlans(dir, project).map((record) => record.id), ["first", "second"]);
		assert.equal(listCompletedPlans(dir, project)[0]?.closeout.outcome, "done");
	} finally { rmSync(dir, { recursive: true, force: true }); }
});

test("project keys are stable and separate different canonical projects", () => {
	assert.equal(planHistoryKey(project), planHistoryKey({ kind: "git", id: "/repo/.git" }));
	assert.notEqual(planHistoryKey(project), planHistoryKey({ kind: "cwd", id: "/repo" }));
});
