import assert from "node:assert/strict";
import test from "node:test";
import { applyPlanUpdate, createPlanState } from "./plan-state.ts";
import { planFooterStatus } from "./plan-status.ts";

const brief = { summary: "summary", findings: [], decisions: [], relevantFiles: [], constraints: [] };
const withPlan = (phase: "drafting" | "ready" | "revising" | "executing" | "paused" | "handed-off") => ({ ...applyPlanUpdate({ ...createPlanState(), phase }, { goal: "Ship", steps: ["Inspect", "Implement"], executionBrief: brief }), phase });

test("footer status distinguishes empty and completed session history", () => {
	assert.equal(planFooterStatus(createPlanState(), 0), "waiting to plan");
	assert.equal(planFooterStatus(createPlanState(), 1), "1 plan executed · waiting for next plan");
	assert.equal(planFooterStatus(createPlanState(), 2), "2 plans executed · waiting for next plan");
});

test("footer status describes restricted, ready, executing, and handed-off plans", () => {
	assert.equal(planFooterStatus({ ...createPlanState(), accessMode: "plan" }, 0), "plan · waiting to plan");
	assert.equal(planFooterStatus({ ...createPlanState(), accessMode: "read-only" }, 0), "read-only · waiting to plan");
	assert.equal(planFooterStatus(withPlan("drafting"), 0), "1 plan · planning");
	assert.equal(planFooterStatus(withPlan("ready"), 0), "1 plan · waiting to execute");
	assert.equal(planFooterStatus(withPlan("paused"), 0), "1 plan · paused");
	const executing = withPlan("executing");
	executing.steps[0]!.completed = true;
	assert.equal(planFooterStatus(executing, 0), "plan 1/2");
	assert.equal(planFooterStatus(withPlan("handed-off"), 0), "1 plan · executing in handoff");
});
