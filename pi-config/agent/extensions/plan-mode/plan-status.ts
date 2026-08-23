import { isStepDone, type PlanState } from "./plan-state.ts";

/** Plain status text consumed by the themed footer status publisher. */
export function planFooterStatus(state: PlanState, completedPlanCount: number): string {
	if (state.phase === "executing" && state.steps.length) return `plan ${state.steps.filter(isStepDone).length}/${state.steps.length}`;
	if (state.phase === "handed-off") return "1 plan · executing in handoff";
	if (state.steps.length) {
		if (state.phase === "drafting" || state.phase === "revising") return "1 plan · planning";
		if (state.phase === "paused") return "1 plan · paused";
		return "1 plan · waiting to execute";
	}
	if (state.accessMode === "read-only") return "read-only · waiting to plan";
	if (state.accessMode === "plan") return "plan · waiting to plan";
	return completedPlanCount ? `${completedPlanCount} plan${completedPlanCount === 1 ? "" : "s"} executed · waiting for next plan` : "waiting to plan";
}
