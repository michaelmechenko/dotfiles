import { randomUUID } from "node:crypto";
import type { TodoItem } from "./utils.ts";

export type AccessMode = "none" | "plan" | "read-only";
export type PlanPhase = "idle" | "drafting" | "ready" | "revising" | "executing" | "paused" | "handed-off";
export type ThinkingLevel = "off" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max";
export interface ModelSnapshot { provider: string; model: string; thinkingLevel: ThinkingLevel; }
export interface ExecutionBrief { summary: string; findings: string[]; decisions: string[]; relevantFiles: { path: string; note: string }[]; constraints: string[]; }
export interface PlanCloseout { goal: string; outcome: string; endState: string; verification: string[]; deviations: string[]; nextSteps: string[]; }
export interface PlanState {
	version: 5; accessMode: AccessMode; phase: PlanPhase; goal: string; steps: TodoItem[]; criteria: string[]; followUps: string[]; executionBrief: ExecutionBrief;
	executionSource?: { sessionId: string; cwd: string; tmuxSession?: string };
	toolsBeforePlan?: string[]; planningModel?: ModelSnapshot; executionModel?: ModelSnapshot; widgetCollapsed: boolean; awaitingReview: boolean; resumeAfterRevision: boolean; completionRequested: boolean; closeout?: PlanCloseout;
}
type LegacyPlanState = Omit<Partial<PlanState>, "version" | "executionBrief"> & { version?: unknown; phase?: string; steps?: Array<Partial<TodoItem>> };

export function emptyExecutionBrief(): ExecutionBrief { return { summary: "", findings: [], decisions: [], relevantFiles: [], constraints: [] }; }
export function createPlanState(): PlanState { return { version: 5, accessMode: "none", phase: "idle", goal: "", steps: [], criteria: [], followUps: [], executionBrief: emptyExecutionBrief(), widgetCollapsed: true, awaitingReview: false, resumeAfterRevision: false, completionRequested: false }; }

/** v2-v4 plans receive deterministic IDs; obsolete parallel state is discarded. */
export function migratePlanState(data: unknown): PlanState | undefined {
	if (!data || typeof data !== "object") return undefined;
	const legacy = data as LegacyPlanState;
	if (legacy.version === 5) return isPlanState(legacy) ? clonePlanState(legacy) : undefined;
	if (legacy.version !== 2 && legacy.version !== 3 && legacy.version !== 4) return undefined;
	const phase = legacy.phase === "planning" ? "drafting" : legacy.phase ?? "idle";
	const steps = Array.isArray(legacy.steps) ? legacy.steps.map((step, index) => ({ id: `legacy-${index + 1}`, step: index + 1, text: typeof step.text === "string" ? step.text : "", completed: step.completed === true, skipped: step.skipped === true })) : [];
	const { workstreams: _workstreams, parallelRun: _parallelRun, ...legacyFields } = legacy as LegacyPlanState & { workstreams?: unknown; parallelRun?: unknown };
	const migrated: PlanState = { ...createPlanState(), ...legacyFields, version: 5, steps, phase: isPlanPhase(phase) ? phase : "idle", accessMode: legacy.version === 2 && (legacy.phase === "planning" || legacy.phase === "revising") ? "plan" : isAccessMode(legacy.accessMode) ? legacy.accessMode : "none", executionBrief: legacy.version === 4 && isExecutionBrief((legacy as { executionBrief?: unknown }).executionBrief) ? cloneExecutionBrief((legacy as { executionBrief: ExecutionBrief }).executionBrief) : emptyExecutionBrief() };
	return isPlanState(migrated) ? clonePlanState(migrated) : undefined;
}

export function enterRestrictedMode(state: PlanState, accessMode: Exclude<AccessMode, "none">, activeTools: string[]): PlanState { const toolsBeforePlan = state.accessMode === "none" && !state.toolsBeforePlan ? [...activeTools] : state.toolsBeforePlan; let phase = state.phase; if (accessMode === "plan") { if (phase === "idle" || (phase === "paused" && state.steps.length === 0)) phase = "drafting"; else if (phase === "paused" && state.steps.length > 0) phase = "ready"; } else if (state.accessMode === "plan" && (phase === "drafting" || phase === "ready" || phase === "revising")) phase = "paused"; return { ...state, accessMode, phase, toolsBeforePlan }; }
export function leaveRestrictedMode(state: PlanState): { state: PlanState; restoreTools?: string[] } { return { state: { ...state, accessMode: "none", toolsBeforePlan: undefined }, restoreTools: state.toolsBeforePlan ? [...state.toolsBeforePlan] : undefined }; }
export function isStepDone(step: TodoItem): boolean { return step.completed || step.skipped; }
export function pendingSteps(state: PlanState): TodoItem[] { return state.steps.filter((step) => !isStepDone(step)); }

export function applyPlanUpdate(state: PlanState, input: { goal: string; steps: string[]; criteria?: string[]; followUps?: string[]; executionBrief: ExecutionBrief }): PlanState {
	const existing = new Map(state.steps.map((step) => [step.text.trim().toLowerCase(), step]));
	const steps = input.steps.map((text, index) => { const previous = existing.get(text.trim().toLowerCase()); return { id: previous?.id ?? randomUUID(), step: index + 1, text, completed: previous?.completed ?? false, skipped: previous?.skipped ?? false }; });
	return { ...state, goal: input.goal, steps, criteria: input.criteria ?? [], followUps: input.followUps ?? [], executionBrief: cloneExecutionBrief(input.executionBrief), phase: state.phase === "drafting" ? "ready" : state.phase, awaitingReview: state.phase === "drafting", completionRequested: false };
}
export function canClosePlan(state: PlanState): boolean { return state.phase === "executing" && state.steps.length > 0 && state.steps.every(isStepDone); }
export function isExecutionBrief(value: unknown): value is ExecutionBrief { if (!value || typeof value !== "object") return false; const brief = value as Partial<ExecutionBrief>; return typeof brief.summary === "string" && isStringArray(brief.findings) && isStringArray(brief.decisions) && isStringArray(brief.constraints) && Array.isArray(brief.relevantFiles) && brief.relevantFiles.every((file) => !!file && typeof file === "object" && typeof (file as { path?: unknown }).path === "string" && typeof (file as { note?: unknown }).note === "string"); }
export function isPlanState(value: unknown): value is PlanState { if (!value || typeof value !== "object") return false; const plan = value as Partial<PlanState>; return plan.version === 5 && isAccessMode(plan.accessMode) && isPlanPhase(plan.phase) && typeof plan.goal === "string" && isTodoList(plan.steps) && isStringArray(plan.criteria) && isStringArray(plan.followUps) && isExecutionBrief(plan.executionBrief) && (plan.executionSource === undefined || isExecutionSource(plan.executionSource)) && (plan.toolsBeforePlan === undefined || isStringArray(plan.toolsBeforePlan)) && (plan.planningModel === undefined || isModelSnapshot(plan.planningModel)) && (plan.executionModel === undefined || isModelSnapshot(plan.executionModel)) && typeof plan.widgetCollapsed === "boolean" && typeof plan.awaitingReview === "boolean" && typeof plan.resumeAfterRevision === "boolean" && typeof plan.completionRequested === "boolean" && (plan.closeout === undefined || isCloseout(plan.closeout)); }
function clonePlanState(state: PlanState): PlanState { return { version: 5, accessMode: state.accessMode, phase: state.phase, goal: state.goal, steps: state.steps.map((step) => ({ ...step })), criteria: [...state.criteria], followUps: [...state.followUps], executionBrief: cloneExecutionBrief(state.executionBrief), executionSource: state.executionSource ? { ...state.executionSource } : undefined, toolsBeforePlan: state.toolsBeforePlan ? [...state.toolsBeforePlan] : undefined, planningModel: state.planningModel ? { ...state.planningModel } : undefined, executionModel: state.executionModel ? { ...state.executionModel } : undefined, widgetCollapsed: state.widgetCollapsed, awaitingReview: state.awaitingReview, resumeAfterRevision: state.resumeAfterRevision, completionRequested: state.completionRequested, closeout: state.closeout ? { ...state.closeout, verification: [...state.closeout.verification], deviations: [...state.closeout.deviations], nextSteps: [...state.closeout.nextSteps] } : undefined }; }
function cloneExecutionBrief(brief: ExecutionBrief): ExecutionBrief { return { summary: brief.summary, findings: [...brief.findings], decisions: [...brief.decisions], relevantFiles: brief.relevantFiles.map((file) => ({ ...file })), constraints: [...brief.constraints] }; }
function isExecutionSource(value: unknown): value is NonNullable<PlanState["executionSource"]> { return !!value && typeof value === "object" && typeof (value as { sessionId?: unknown }).sessionId === "string" && typeof (value as { cwd?: unknown }).cwd === "string" && ((value as { tmuxSession?: unknown }).tmuxSession === undefined || typeof (value as { tmuxSession?: unknown }).tmuxSession === "string"); }
function isModelSnapshot(value: unknown): value is ModelSnapshot { return !!value && typeof value === "object" && typeof (value as ModelSnapshot).provider === "string" && typeof (value as ModelSnapshot).model === "string" && isThinkingLevel((value as ModelSnapshot).thinkingLevel); }
function isCloseout(value: unknown): value is PlanCloseout { return !!value && typeof value === "object" && typeof (value as PlanCloseout).goal === "string" && typeof (value as PlanCloseout).outcome === "string" && typeof (value as PlanCloseout).endState === "string" && isStringArray((value as PlanCloseout).verification) && isStringArray((value as PlanCloseout).deviations) && isStringArray((value as PlanCloseout).nextSteps); }
function isTodoList(value: unknown): value is TodoItem[] { return Array.isArray(value) && value.every((step) => !!step && typeof step === "object" && typeof (step as TodoItem).id === "string" && Number.isInteger((step as TodoItem).step) && typeof (step as TodoItem).text === "string" && typeof (step as TodoItem).completed === "boolean" && typeof (step as TodoItem).skipped === "boolean"); }
function isStringArray(value: unknown): value is string[] { return Array.isArray(value) && value.every((item) => typeof item === "string"); }
function isAccessMode(value: unknown): value is AccessMode { return value === "none" || value === "plan" || value === "read-only"; }
function isPlanPhase(value: unknown): value is PlanPhase { return value === "idle" || value === "drafting" || value === "ready" || value === "revising" || value === "executing" || value === "paused" || value === "handed-off"; }
function isThinkingLevel(value: unknown): value is ThinkingLevel { return value === "off" || value === "minimal" || value === "low" || value === "medium" || value === "high" || value === "xhigh" || value === "max"; }
