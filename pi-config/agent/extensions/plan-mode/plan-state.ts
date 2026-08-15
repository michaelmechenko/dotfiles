import type { TodoItem } from "./utils.ts";

export type AccessMode = "none" | "plan" | "read-only";
export type PlanPhase = "idle" | "drafting" | "ready" | "revising" | "executing" | "paused" | "handed-off";
export type ThinkingLevel = "off" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max";

export interface ModelSnapshot {
	provider: string;
	model: string;
	thinkingLevel: ThinkingLevel;
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
	version: 3;
	accessMode: AccessMode;
	phase: PlanPhase;
	goal: string;
	steps: TodoItem[];
	criteria: string[];
	followUps: string[];
	/** Exact active-tool set captured before entering a restricted mode. */
	toolsBeforePlan?: string[];
	planningModel?: ModelSnapshot;
	/** Model selected for the active execution, including a transient choice. */
	executionModel?: ModelSnapshot;
	widgetCollapsed: boolean;
	awaitingReview: boolean;
	resumeAfterRevision: boolean;
	completionRequested: boolean;
	closeout?: PlanCloseout;
}

export interface LegacyPlanStateV2 {
	version: 2;
	phase?: "idle" | "planning" | "executing" | "revising" | "paused";
	goal?: string;
	steps?: TodoItem[];
	criteria?: string[];
	followUps?: string[];
	toolsBeforePlan?: string[];
	planningModel?: ModelSnapshot;
	widgetCollapsed?: boolean;
	awaitingReview?: boolean;
	resumeAfterRevision?: boolean;
	completionRequested?: boolean;
	closeout?: PlanCloseout;
}

export function createPlanState(): PlanState {
	return {
		version: 3,
		accessMode: "none",
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

export function migratePlanState(data: unknown): PlanState | undefined {
	if (!data || typeof data !== "object") return undefined;
	const value = data as Partial<PlanState>;
	if (value.version === 3 && isAccessMode(value.accessMode) && isPlanPhase(value.phase)) {
		return { ...createPlanState(), ...value, version: 3, accessMode: value.accessMode, phase: value.phase };
	}
	const legacy = data as LegacyPlanStateV2;
	if (legacy.version !== 2) return undefined;
	const phase = legacy.phase === "planning" ? "drafting" : legacy.phase ?? "idle";
	const normalizedPhase: PlanPhase = phase === "revising" || phase === "executing" || phase === "paused" || phase === "idle" || phase === "drafting" ? phase : "idle";
	return {
		...createPlanState(),
		...legacy,
		version: 3,
		phase: normalizedPhase,
		accessMode: legacy.phase === "planning" || legacy.phase === "revising" ? "plan" : "none",
		toolsBeforePlan: legacy.toolsBeforePlan ? [...legacy.toolsBeforePlan] : undefined,
	};
}

export function enterRestrictedMode(state: PlanState, accessMode: Exclude<AccessMode, "none">, activeTools: string[]): PlanState {
	const toolsBeforePlan = state.accessMode === "none" && !state.toolsBeforePlan ? [...activeTools] : state.toolsBeforePlan;
	let phase = state.phase;
	if (accessMode === "plan") {
		if (phase === "idle" || (phase === "paused" && state.steps.length === 0)) phase = "drafting";
		else if (phase === "paused" && state.steps.length > 0) phase = "ready";
	} else if (state.accessMode === "plan" && (phase === "drafting" || phase === "ready" || phase === "revising")) {
		phase = "paused";
	}
	return { ...state, accessMode, phase, toolsBeforePlan };
}

export function leaveRestrictedMode(state: PlanState): { state: PlanState; restoreTools?: string[] } {
	return {
		state: { ...state, accessMode: "none", toolsBeforePlan: undefined },
		restoreTools: state.toolsBeforePlan ? [...state.toolsBeforePlan] : undefined,
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
		return { step: index + 1, text, completed: previous?.completed ?? false, skipped: previous?.skipped ?? false };
	});
	return {
		...state,
		goal: input.goal,
		steps,
		criteria: input.criteria ?? [],
		followUps: input.followUps ?? [],
		phase: state.phase === "drafting" ? "ready" : state.phase,
		awaitingReview: state.phase === "drafting",
		completionRequested: false,
	};
}

export function canClosePlan(state: PlanState): boolean {
	return state.phase === "executing" && state.steps.length > 0 && state.steps.every(isStepDone);
}

function isAccessMode(value: unknown): value is AccessMode {
	return value === "none" || value === "plan" || value === "read-only";
}

function isPlanPhase(value: unknown): value is PlanPhase {
	return value === "idle" || value === "drafting" || value === "ready" || value === "revising" || value === "executing" || value === "paused" || value === "handed-off";
}
