import assert from "node:assert/strict";
import test from "node:test";
import { restorePlanLifecycle } from "./lifecycle.ts";
import { createPlanState } from "./plan-state.ts";

const available = ["read", "bash", "write", "plan_update", "plan_step", "plan_complete"];
const planningModel = { provider: "test", model: "planner", thinkingLevel: "high" as const };
const executionModel = { provider: "test", model: "executor", thinkingLevel: "medium" as const };

test("branch restoration reactivates restricted tools and the planning model", () => {
	const restored = { ...createPlanState(), accessMode: "plan" as const, phase: "ready" as const, toolsBeforePlan: ["read", "bash", "write"], planningModel };
	const result = restorePlanLifecycle(createPlanState(), restored, available, available);
	assert.deepEqual(result.tools, ["read", "bash", "plan_update"]);
	assert.deepEqual(result.model, planningModel);
});

test("branch restoration swaps execution tools/model and restores the prior baseline when leaving", () => {
	const executing = { ...createPlanState(), phase: "executing" as const, toolsBeforePlan: ["read", "bash", "write"], planningModel, executionModel };
	const active = restorePlanLifecycle(createPlanState(), executing, ["read"], available);
	assert.deepEqual(active.tools, ["read", "bash", "write", "plan_step", "plan_update", "plan_complete"]);
	assert.deepEqual(active.model, executionModel);
	const left = restorePlanLifecycle(executing, createPlanState(), active.tools, available);
	assert.deepEqual(left.tools, ["read", "bash", "write"]);
	assert.deepEqual(left.model, planningModel);
});
