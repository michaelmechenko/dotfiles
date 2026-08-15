import assert from "node:assert/strict";
import test from "node:test";
import { applyPlanUpdate, canClosePlan, createPlanState, enterRestrictedMode, leaveRestrictedMode, migratePlanState, pendingSteps } from "./plan-state.ts";

test("plan updates preserve completed steps with unchanged text", () => {
	const initial = applyPlanUpdate(createPlanState(), { goal: "Ship the change", steps: ["Inspect current behavior", "Implement the change"] });
	initial.steps[0]!.completed = true;
	const revised = applyPlanUpdate(initial, { goal: "Ship the narrowed change", steps: ["Inspect current behavior", "Implement the narrowed change", "Verify the result"] });
	assert.equal(revised.steps[0]!.completed, true);
	assert.deepEqual(pendingSteps(revised).map((step) => step.text), ["Implement the narrowed change", "Verify the result"]);
});

test("a plan closes only after every step is terminal", () => {
	const state = applyPlanUpdate({ ...createPlanState(), phase: "executing" }, { goal: "Ship the change", steps: ["Implement", "Verify"] });
	state.steps[0]!.completed = true;
	assert.equal(canClosePlan(state), false);
	state.steps[1]!.skipped = true;
	assert.equal(canClosePlan(state), true);
});

test("v3 access mode cycle preserves paused work and exact baseline", () => {
	const baseline = ["read", "bash", "custom_tool"];
	let state = createPlanState();
	state = enterRestrictedMode(state, "plan", baseline);
	assert.equal(state.phase, "drafting");
	assert.deepEqual(state.toolsBeforePlan, baseline);
	state = applyPlanUpdate(state, { goal: "Ship", steps: ["Inspect"] });
	state = enterRestrictedMode(state, "read-only", ["read"]);
	assert.equal(state.phase, "paused");
	assert.equal(state.accessMode, "read-only");
	const left = leaveRestrictedMode(state);
	assert.deepEqual(left.restoreTools, baseline);
	assert.equal(left.state.accessMode, "none");
	assert.equal(left.state.toolsBeforePlan, undefined);
	const reopened = enterRestrictedMode(left.state, "plan", baseline);
	assert.equal(reopened.phase, "ready");
	const emptyPaused = enterRestrictedMode({ ...createPlanState(), phase: "paused" }, "plan", baseline);
	assert.equal(emptyPaused.phase, "drafting");
});

test("v2 migration maps restrictions without losing execution and paused workflows", () => {
	const planning = migratePlanState({ version: 2, phase: "planning", toolsBeforePlan: ["read", "custom"] });
	assert.equal(planning?.version, 3);
	assert.equal(planning?.accessMode, "plan");
	assert.equal(planning?.phase, "drafting");
	assert.deepEqual(planning?.toolsBeforePlan, ["read", "custom"]);
	const executing = migratePlanState({ version: 2, phase: "executing" });
	assert.equal(executing?.accessMode, "none");
	assert.equal(executing?.phase, "executing");
	const paused = migratePlanState({ version: 2, phase: "paused" });
	assert.equal(paused?.accessMode, "none");
	assert.equal(paused?.phase, "paused");
});
