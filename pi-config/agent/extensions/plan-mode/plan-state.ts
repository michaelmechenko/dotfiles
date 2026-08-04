import type { TodoItem } from "./utils.ts";

export type PlanPhase = "idle" | "planning" | "executing" | "revising" | "paused";

export interface ModelSnapshot {
	provider: string;
	model: string;
	thinkingLevel: "off" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max";
}

export interface PlanCloseout {
	goal: string;
	outcome: string;
	endState: string;
	verification: string[];
	deviations: string[];
	nextSteps: string[];
}

export interface PlanState {
	version: 2;
	phase: PlanPhase;
	goal: string;
	steps: TodoItem[];
	criteria: string[];
	followUps: string[];
	toolsBeforePlan?: string[];
	planningModel?: ModelSnapshot;
	widgetCollapsed: boolean;
	awaitingReview: boolean;
	resumeAfterRevision: boolean;
	completionRequested: boolean;
	closeout?: PlanCloseout;
}

export function createPlanState(): PlanState {
	return {
		version: 2,
		phase: "idle",
		goal: "",
		steps: [],
		criteria: [],
		followUps: [],
		widgetCollapsed: true,
		awaitingReview: false,
		resumeAfterRevision: false,
		completionRequested: false,
	};
}

export function isStepDone(step: TodoItem): boolean {
	return step.completed || step.skipped;
}

export function pendingSteps(state: PlanState): TodoItem[] {
	return state.steps.filter((step) => !isStepDone(step));
}

export function applyPlanUpdate(
	state: PlanState,
	input: { goal: string; steps: string[]; criteria?: string[]; followUps?: string[] },
): PlanState {
	const existing = new Map(state.steps.map((step) => [step.text.trim().toLowerCase(), step]));
	const steps = input.steps.map((text, index) => {
		const previous = existing.get(text.trim().toLowerCase());
		return {
			step: index + 1,
			text,
			completed: previous?.completed ?? false,
			skipped: previous?.skipped ?? false,
		};
	});
	return {
		...state,
		goal: input.goal,
		steps,
		criteria: input.criteria ?? [],
		followUps: input.followUps ?? [],
		awaitingReview: state.phase === "planning",
		completionRequested: false,
	};
}

export function canClosePlan(state: PlanState): boolean {
	return state.phase === "executing" && state.steps.length > 0 && state.steps.every(isStepDone);
}
