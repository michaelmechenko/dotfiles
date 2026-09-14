import { materializePlan, type ModelSnapshot, type PlanState } from "./plan-state.ts";
import { PLAN_EXECUTION_TOOLS, restrictedTools } from "./restricted-mode.ts";

export interface RestoredLifecycle {
	state: PlanState;
	tools: string[];
	model?: ModelSnapshot;
}

/** Derive the complete branch-local plan activation without mutating either snapshot. */
export function restorePlanLifecycle(previous: PlanState, restored: PlanState, currentTools: string[], availableTools: string[]): RestoredLifecycle {
	let state = materializePlan(restored);
	if (state.accessMode !== "none" && !state.toolsBeforePlan) state = { ...state, toolsBeforePlan: previous.toolsBeforePlan ?? [...currentTools] };
	let tools: string[];
	if (state.accessMode !== "none") tools = restrictedTools(state.accessMode, state.toolsBeforePlan ?? currentTools, availableTools);
	else if (state.phase === "executing") tools = [...new Set([...(state.toolsBeforePlan ?? currentTools), ...PLAN_EXECUTION_TOOLS])].filter((name) => availableTools.includes(name));
	else tools = [...(state.toolsBeforePlan ?? previous.toolsBeforePlan ?? currentTools)].filter((name) => availableTools.includes(name) && !PLAN_EXECUTION_TOOLS.includes(name));
	const model = state.phase === "executing"
		? state.executionModel
		: state.planningModel ?? ((previous.phase === "executing" || previous.phase === "revising") ? previous.planningModel : undefined);
	return { state, tools: [...new Set(tools)], model };
}
