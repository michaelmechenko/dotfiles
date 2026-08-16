import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createParallelRun, scopedPlan } from "./execution-orchestrator.ts";
import { applyPlanUpdate, createPlanState } from "./plan-state.ts";

const brief = { summary: "summary", findings: [], decisions: [], relevantFiles: [], constraints: [] };
const model = { provider: "test", model: "test", thinkingLevel: "low" as const };
test("parallel run creates scoped private worker packets in declaration order", () => {
	const dir = mkdtempSync(join(tmpdir(), "parallel-plan-"));
	try {
		const plan = applyPlanUpdate(createPlanState(), { goal: "Ship", steps: ["Runtime", "State", "Verify"], executionBrief: brief, workstreams: [{ id: "runtime", title: "Runtime", objective: "Build runtime", steps: [1, 3], ownedPaths: ["tmux"] }, { id: "state", title: "State", objective: "Build state", steps: [2], ownedPaths: ["plan"] }] });
		const scoped = scopedPlan(plan, plan.workstreams![0]!); assert.deepEqual(scoped.steps.map((step) => step.text), ["Runtime", "Verify"]); assert.equal(scoped.workstreams, undefined);
		const run = createParallelRun(dir, plan, { sessionId: "source", cwd: "/tmp/work", tmuxSession: "work" }, model); assert.equal(run.workers.length, 2); assert.deepEqual(run.workers.map((worker) => worker.streamId), ["runtime", "state"]); assert.ok(run.workers.every((worker) => worker.packetPath.includes("plan-handoffs") && worker.releasePath.includes("plan-parallel")));
	} finally { rmSync(dir, { recursive: true, force: true }); }
});
