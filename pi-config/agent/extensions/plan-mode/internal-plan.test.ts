import assert from "node:assert/strict";
import test from "node:test";
import { canUpdateTrackedPlan, createInternalPlan, internalPlanFromDetails, latestInternalPlan, resolvePlanUpdateScope } from "./internal-plan.ts";
import { createPlanState, type AccessMode, type PlanPhase } from "./plan-state.ts";

const payload = {
	goal: "Coordinate work",
	steps: ["Inspect", "Change", "Verify"],
	criteria: ["Tests pass"],
	followUps: ["Activate later"],
	executionBrief: {
		summary: "Internal only",
		findings: ["One finding"],
		decisions: ["One decision"],
		relevantFiles: [{ path: "index.ts", note: "Routing" }],
		constraints: ["Do not track"],
	},
};

const phases: PlanPhase[] = ["idle", "drafting", "ready", "revising", "executing", "paused", "handed-off"];
const modes: AccessMode[] = ["none", "plan", "read-only"];

test("explicit internal scope is accepted in every access mode and tracked phase", () => {
	for (const mode of modes) for (const phase of phases) assert.equal(resolvePlanUpdateScope("internal", mode, phase), "internal");
});

test("omitted scope targets tracked plans only during explicit planning or execution", () => {
	assert.equal(resolvePlanUpdateScope(undefined, "plan", "ready"), "tracked");
	assert.equal(resolvePlanUpdateScope(undefined, "none", "executing"), "tracked");
	assert.equal(resolvePlanUpdateScope(undefined, "none", "paused"), "internal");
	assert.equal(resolvePlanUpdateScope(undefined, "read-only", "executing"), "internal");
	assert.equal(canUpdateTrackedPlan("read-only", "executing"), false);
	assert.equal(canUpdateTrackedPlan("read-only", "paused"), false);
});

test("internal plans are isolated snapshots and do not materialize tracked state", () => {
	const tracked = createPlanState();
	const internal = createInternalPlan(payload);
	payload.steps[0] = "Mutated input";
	payload.executionBrief.findings[0] = "Mutated finding";
	assert.equal(internal.steps[0], "Inspect");
	assert.equal(internal.executionBrief.findings[0], "One finding");
	assert.deepEqual(tracked, createPlanState());
	assert.equal(tracked.planId, undefined);
	assert.equal(tracked.steps.length, 0);
});

test("only discriminated valid internal tool details restore branch-local state", () => {
	const internal = createInternalPlan({ ...payload, steps: ["Inspect"], executionBrief: { ...payload.executionBrief, findings: ["One finding"] } });
	const restored = internalPlanFromDetails({ scope: "internal", internalPlan: internal });
	assert.deepEqual(restored, internal);
	assert.notEqual(restored, internal);
	assert.equal(internalPlanFromDetails({ scope: "tracked", internalPlan: internal }), undefined);
	assert.equal(internalPlanFromDetails({ scope: "internal", internalPlan: { ...internal, version: 2 } }), undefined);
	const newer = createInternalPlan({ ...payload, goal: "Newer", steps: ["Verify"], executionBrief: { ...payload.executionBrief, findings: ["One finding"] } });
	assert.deepEqual(latestInternalPlan([{ scope: "internal", internalPlan: internal }, { scope: "tracked" }, { scope: "internal", internalPlan: newer }]), newer);
});
