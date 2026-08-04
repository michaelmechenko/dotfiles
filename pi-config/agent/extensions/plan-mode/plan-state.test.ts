import assert from "node:assert/strict";
import test from "node:test";
import { applyPlanUpdate, canClosePlan, createPlanState, pendingSteps } from "./plan-state.ts";

test("plan updates preserve completed steps with unchanged text", () => {
	const initial = applyPlanUpdate(createPlanState(), {
		goal: "Ship the change",
		steps: ["Inspect current behavior", "Implement the change"],
	});
	initial.steps[0]!.completed = true;
	const revised = applyPlanUpdate(initial, {
		goal: "Ship the narrowed change",
		steps: ["Inspect current behavior", "Implement the narrowed change", "Verify the result"],
	});
	assert.equal(revised.steps[0]!.completed, true);
	assert.equal(revised.steps[1]!.completed, false);
	assert.deepEqual(pendingSteps(revised).map((step) => step.text), ["Implement the narrowed change", "Verify the result"]);
});

test("a plan closes only after every step is terminal", () => {
	const state = applyPlanUpdate({ ...createPlanState(), phase: "executing" }, {
		goal: "Ship the change",
		steps: ["Implement", "Verify"],
	});
	state.steps[0]!.completed = true;
	assert.equal(canClosePlan(state), false);
	state.steps[1]!.skipped = true;
	assert.equal(canClosePlan(state), true);
});
