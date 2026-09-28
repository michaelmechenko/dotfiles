import type { AccessMode, ExecutionBrief, PlanPhase } from "./plan-state.ts";

export type PlanUpdateScope = "internal" | "tracked";

export interface PlanUpdatePayload {
	goal: string;
	steps: string[];
	criteria?: string[];
	followUps?: string[];
	executionBrief: ExecutionBrief;
}

export interface InternalPlan {
	version: 1;
	goal: string;
	steps: string[];
	criteria: string[];
	followUps: string[];
	executionBrief: ExecutionBrief;
}

export interface InternalPlanDetails {
	scope: "internal";
	internalPlan: InternalPlan;
}

export function resolvePlanUpdateScope(requested: PlanUpdateScope | undefined, accessMode: AccessMode, phase: PlanPhase): PlanUpdateScope {
	if (requested) return requested;
	if (accessMode === "read-only") return "internal";
	return accessMode === "plan" || phase === "executing" ? "tracked" : "internal";
}

export function canUpdateTrackedPlan(accessMode: AccessMode, phase: PlanPhase): boolean {
	return accessMode === "plan" || (accessMode === "none" && phase === "executing");
}

export function createInternalPlan(input: PlanUpdatePayload): InternalPlan {
	return {
		version: 1,
		goal: input.goal,
		steps: [...input.steps],
		criteria: [...(input.criteria ?? [])],
		followUps: [...(input.followUps ?? [])],
		executionBrief: {
			summary: input.executionBrief.summary,
			findings: [...input.executionBrief.findings],
			decisions: [...input.executionBrief.decisions],
			relevantFiles: input.executionBrief.relevantFiles.map((file) => ({ ...file })),
			constraints: [...input.executionBrief.constraints],
		},
	};
}

export function isInternalPlan(value: unknown): value is InternalPlan {
	if (!value || typeof value !== "object") return false;
	const plan = value as Partial<InternalPlan>;
	return plan.version === 1
		&& typeof plan.goal === "string"
		&& isStringArray(plan.steps)
		&& isStringArray(plan.criteria)
		&& isStringArray(plan.followUps)
		&& isExecutionBrief(plan.executionBrief);
}

export function internalPlanFromDetails(value: unknown): InternalPlan | undefined {
	if (!value || typeof value !== "object") return undefined;
	const details = value as Partial<InternalPlanDetails>;
	return details.scope === "internal" && isInternalPlan(details.internalPlan)
		? createInternalPlan(details.internalPlan)
		: undefined;
}

export function latestInternalPlan(detailValues: Iterable<unknown>): InternalPlan | undefined {
	let latest: InternalPlan | undefined;
	for (const value of detailValues) latest = internalPlanFromDetails(value) ?? latest;
	return latest;
}

function isStringArray(value: unknown): value is string[] {
	return Array.isArray(value) && value.every((item) => typeof item === "string");
}

function isExecutionBrief(value: unknown): value is ExecutionBrief {
	if (!value || typeof value !== "object") return false;
	const brief = value as Partial<ExecutionBrief>;
	return typeof brief.summary === "string"
		&& isStringArray(brief.findings)
		&& isStringArray(brief.decisions)
		&& Array.isArray(brief.relevantFiles)
		&& brief.relevantFiles.every((file) => Boolean(file) && typeof file === "object" && typeof file.path === "string" && typeof file.note === "string")
		&& isStringArray(brief.constraints);
}
