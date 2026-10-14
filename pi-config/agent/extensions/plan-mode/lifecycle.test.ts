import assert from "node:assert/strict";
import test from "node:test";
import { PlanLifecycle, PlanMutationQueue, lifecycleGuard, restorePlanLifecycle, transitionPlanLifecycle } from "./lifecycle.ts";
import { createPlanState } from "./plan-state.ts";

const available = ["read", "bash", "write", "plan_update", "plan_step", "plan_complete"];
const planningModel = { provider: "test", model: "planner", thinkingLevel: "high" as const };
const executionModel = { provider: "test", model: "executor", thinkingLevel: "medium" as const };

test("branch restoration reactivates restricted tools and the planning model", () => {
	const restored = { ...createPlanState(), accessMode: "plan" as const, phase: "ready" as const, toolsBeforePlan: ["read", "bash", "write", "plan_update"], planningModel };
	const result = restorePlanLifecycle(createPlanState(), restored, available, available);
	assert.deepEqual(result.tools, ["read", "bash", "plan_update"]);
	assert.deepEqual(result.model, planningModel);
});

test("branch restoration swaps execution tools/model and restores the prior baseline when leaving", () => {
	const executing = { ...createPlanState(), phase: "executing" as const, toolsBeforePlan: ["read", "bash", "write"], planningModel, executionModel };
	const active = restorePlanLifecycle(createPlanState(), executing, ["read"], available);
	assert.deepEqual(active.tools, ["read", "bash", "write", "plan_step", "plan_complete"]);
	assert.deepEqual(active.model, executionModel);
	const left = restorePlanLifecycle(executing, createPlanState(), ["read"], available);
	assert.deepEqual(left.tools, ["read"]);
	assert.equal(left.model, undefined);
});

test("an unrelated branch never inherits tools or model from the abandoned execution", () => {
	const prior = { ...createPlanState(), phase: "executing" as const, toolsBeforePlan: ["read", "write"], planningModel, executionModel };
	const restored = restorePlanLifecycle(prior, createPlanState(), ["read"], available);
	assert.deepEqual(restored.tools, ["read"]);
	assert.equal(restored.model, undefined);
});

test("normal and read-only restoration retain internal planning without execution tools", () => {
	const normal = restorePlanLifecycle(createPlanState(), createPlanState(), ["read", "write", "plan_update"], available);
	assert.deepEqual(normal.tools, ["read", "write", "plan_update"]);
	const readOnly = { ...createPlanState(), accessMode: "read-only" as const, toolsBeforePlan: ["read", "write", "plan_update"] };
	const restricted = restorePlanLifecycle(createPlanState(), readOnly, available, available);
	assert.deepEqual(restricted.tools, ["read", "plan_update"]);
});
test("mutation queue serializes short commits and gives queued user work priority", async () => { const queue = new PlanMutationQueue(); const order: string[] = []; await Promise.all([queue.run(() => order.push("first tool"), "tool"), queue.run(() => order.push("second tool"), "tool"), queue.run(() => order.push("user"))]); assert.deepEqual(order, ["user", "first tool", "second tool"]); assert.equal(lifecycleGuard(1, "a", 1, "a"), true); assert.equal(lifecycleGuard(1, "a", 2, "a"), false); assert.equal(lifecycleGuard(1, "a", 1, "b"), false); });

test("navigation fences stale effects while ordinary branch appends remain current", () => { const lifecycle = new PlanLifecycle(); lifecycle.startSession("a", "root"); const beforeAppend = lifecycle.capture(); assert.equal(lifecycle.observeBranch("a", "child", ["root", "child"]), false); assert.equal(lifecycle.isCurrent(beforeAppend, "a", ["root", "child"]), true); const beforeNavigation = lifecycle.capture(); assert.equal(lifecycle.observeBranch("a", "sibling", ["root", "sibling"]), true); assert.equal(lifecycle.isCurrent(beforeNavigation, "a", ["root", "sibling"]), false); });

test("execution transition creates a fresh execution identity", () => { const state = transitionPlanLifecycle({ ...createPlanState(), steps: [{ id: "one", step: 1, text: "Do it", completed: false, skipped: false }] }, { type: "execute", model: executionModel, source: { sessionId: "session", cwd: "/tmp" }, executionId: "attempt-2", planningModel }); assert.equal(state.executionId, "attempt-2"); assert.equal(state.phase, "executing"); assert.deepEqual(state.continuation, { used: 0 }); });
test("automatic recalibration keeps its execution rescue allowance", () => { const state = transitionPlanLifecycle({ ...createPlanState(), phase: "revising", continuation: { used: 7, lastCheckpoint: "bash:checkpoint" } }, { type: "execute", model: executionModel, source: { sessionId: "session", cwd: "/tmp" }, executionId: "attempt-2", planningModel, resetContinuation: false }); assert.deepEqual(state.continuation, { used: 7, lastCheckpoint: "bash:checkpoint" }); });
