import { randomUUID } from "node:crypto";
import type { TodoItem } from "./utils.ts";

export type AccessMode = "none" | "plan" | "read-only";
export type PlanPhase = "idle" | "drafting" | "ready" | "revising" | "executing" | "paused" | "handed-off";
export type ThinkingLevel = "off" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max";
export interface ModelSnapshot { provider: string; model: string; thinkingLevel: ThinkingLevel; }
export interface ExecutionBrief { summary: string; findings: string[]; decisions: string[]; relevantFiles: { path: string; note: string }[]; constraints: string[]; }
export interface PlanCloseout { goal: string; outcome: string; endState: string; verification: string[]; deviations: string[]; nextSteps: string[]; }
export interface Workstream { id: string; title: string; objective: string; stepIds: string[]; ownedPaths: string[]; }
export interface WorkstreamInput { id: string; title: string; objective: string; steps: number[]; ownedPaths: string[]; }
export interface PlanState {
	version: 5; accessMode: AccessMode; phase: PlanPhase; goal: string; steps: TodoItem[]; criteria: string[]; followUps: string[]; executionBrief: ExecutionBrief;
	workstreams?: Workstream[];
	parallelRun?: { id: string; phase: "provisioning" | "awaiting-acknowledgements" | "released" | "failed" | "reported" };
	executionSource?: { sessionId: string; cwd: string; tmuxSession?: string };
	toolsBeforePlan?: string[]; planningModel?: ModelSnapshot; executionModel?: ModelSnapshot; widgetCollapsed: boolean; awaitingReview: boolean; resumeAfterRevision: boolean; completionRequested: boolean; closeout?: PlanCloseout;
}
type LegacyPlanState = Omit<Partial<PlanState>, "version" | "executionBrief"> & { version?: unknown; phase?: string; steps?: Array<Partial<TodoItem>> };

export function emptyExecutionBrief(): ExecutionBrief { return { summary: "", findings: [], decisions: [], relevantFiles: [], constraints: [] }; }
export function createPlanState(): PlanState { return { version: 5, accessMode: "none", phase: "idle", goal: "", steps: [], criteria: [], followUps: [], executionBrief: emptyExecutionBrief(), widgetCollapsed: true, awaitingReview: false, resumeAfterRevision: false, completionRequested: false }; }

/** v2-v4 plans receive deterministic IDs and no workstreams; v5 validation fails closed. */
export function migratePlanState(data: unknown): PlanState | undefined {
	if (!data || typeof data !== "object") return undefined;
	const legacy = data as LegacyPlanState;
	if (legacy.version === 5) return isPlanState(legacy) ? clonePlanState(legacy) : undefined;
	if (legacy.version !== 2 && legacy.version !== 3 && legacy.version !== 4) return undefined;
	const phase = legacy.phase === "planning" ? "drafting" : legacy.phase ?? "idle";
	const steps = Array.isArray(legacy.steps) ? legacy.steps.map((step, index) => ({ id: `legacy-${index + 1}`, step: index + 1, text: typeof step.text === "string" ? step.text : "", completed: step.completed === true, skipped: step.skipped === true })) : [];
	const migrated: PlanState = { ...createPlanState(), ...legacy, version: 5, steps, phase: isPlanPhase(phase) ? phase : "idle", accessMode: legacy.version === 2 && (legacy.phase === "planning" || legacy.phase === "revising") ? "plan" : isAccessMode(legacy.accessMode) ? legacy.accessMode : "none", executionBrief: legacy.version === 4 && isExecutionBrief((legacy as { executionBrief?: unknown }).executionBrief) ? cloneExecutionBrief((legacy as { executionBrief: ExecutionBrief }).executionBrief) : emptyExecutionBrief(), workstreams: undefined };
	return isPlanState(migrated) ? clonePlanState(migrated) : undefined;
}

export function enterRestrictedMode(state: PlanState, accessMode: Exclude<AccessMode, "none">, activeTools: string[]): PlanState { const toolsBeforePlan = state.accessMode === "none" && !state.toolsBeforePlan ? [...activeTools] : state.toolsBeforePlan; let phase = state.phase; if (accessMode === "plan") { if (phase === "idle" || (phase === "paused" && state.steps.length === 0)) phase = "drafting"; else if (phase === "paused" && state.steps.length > 0) phase = "ready"; } else if (state.accessMode === "plan" && (phase === "drafting" || phase === "ready" || phase === "revising")) phase = "paused"; return { ...state, accessMode, phase, toolsBeforePlan }; }
export function leaveRestrictedMode(state: PlanState): { state: PlanState; restoreTools?: string[] } { return { state: { ...state, accessMode: "none", toolsBeforePlan: undefined }, restoreTools: state.toolsBeforePlan ? [...state.toolsBeforePlan] : undefined }; }
export function isStepDone(step: TodoItem): boolean { return step.completed || step.skipped; }
export function pendingSteps(state: PlanState): TodoItem[] { return state.steps.filter((step) => !isStepDone(step)); }

export function applyPlanUpdate(state: PlanState, input: { goal: string; steps: string[]; criteria?: string[]; followUps?: string[]; executionBrief: ExecutionBrief; workstreams?: WorkstreamInput[] }): PlanState {
	const existing = new Map(state.steps.map((step) => [step.text.trim().toLowerCase(), step]));
	const steps = input.steps.map((text, index) => { const previous = existing.get(text.trim().toLowerCase()); return { id: previous?.id ?? randomUUID(), step: index + 1, text, completed: previous?.completed ?? false, skipped: previous?.skipped ?? false }; });
	const workstreams = input.workstreams === undefined ? undefined : validateWorkstreams(input.workstreams, steps);
	return { ...state, goal: input.goal, steps, criteria: input.criteria ?? [], followUps: input.followUps ?? [], executionBrief: cloneExecutionBrief(input.executionBrief), workstreams, phase: state.phase === "drafting" ? "ready" : state.phase, awaitingReview: state.phase === "drafting", completionRequested: false };
}

/** Worker declarations must partition every step exactly once and own disjoint path subtrees. */
export function validateWorkstreams(inputs: WorkstreamInput[], steps: TodoItem[]): Workstream[] {
	if (inputs.length < 2 || inputs.length > 6) throw new Error("workstreams must contain 2 to 6 entries.");
	const ids = new Set<string>(), numbers = new Set<number>(), paths: string[] = [];
	const streams = inputs.map((input) => {
		if (!validIdentifier(input.id) || ids.has(input.id)) throw new Error("workstream ids must be unique lowercase identifiers."); ids.add(input.id);
		if (!input.title.trim() || !input.objective.trim() || !Array.isArray(input.steps) || !input.steps.length || !Array.isArray(input.ownedPaths) || !input.ownedPaths.length) throw new Error("each workstream requires title, objective, steps, and ownedPaths.");
		const stepIds = input.steps.map((number) => { if (!Number.isInteger(number) || number < 1 || number > steps.length || numbers.has(number)) throw new Error("workstream steps must be unique valid plan step numbers."); numbers.add(number); return steps[number - 1]!.id; });
		const ownedPaths = input.ownedPaths.map(normalizePath); for (const path of ownedPaths) { if (paths.some((other) => pathsOverlap(other, path))) throw new Error("workstream ownedPaths must not overlap."); paths.push(path); }
		return { id: input.id, title: input.title.trim(), objective: input.objective.trim(), stepIds, ownedPaths };
	});
	if (numbers.size !== steps.length) throw new Error("workstreams must assign every plan step exactly once."); return streams;
}
export function canClosePlan(state: PlanState): boolean { return state.phase === "executing" && state.steps.length > 0 && state.steps.every(isStepDone); }
export function isExecutionBrief(value: unknown): value is ExecutionBrief { if (!value || typeof value !== "object") return false; const brief = value as Partial<ExecutionBrief>; return typeof brief.summary === "string" && isStringArray(brief.findings) && isStringArray(brief.decisions) && isStringArray(brief.constraints) && Array.isArray(brief.relevantFiles) && brief.relevantFiles.every((file) => !!file && typeof file === "object" && typeof (file as { path?: unknown }).path === "string" && typeof (file as { note?: unknown }).note === "string"); }
export function isPlanState(value: unknown): value is PlanState { if (!value || typeof value !== "object") return false; const plan = value as Partial<PlanState>; return plan.version === 5 && isAccessMode(plan.accessMode) && isPlanPhase(plan.phase) && typeof plan.goal === "string" && isTodoList(plan.steps) && isStringArray(plan.criteria) && isStringArray(plan.followUps) && isExecutionBrief(plan.executionBrief) && (plan.workstreams === undefined || isWorkstreams(plan.workstreams, plan.steps)) && (plan.parallelRun === undefined || isParallelRunRef(plan.parallelRun)) && (plan.executionSource === undefined || isExecutionSource(plan.executionSource)) && (plan.toolsBeforePlan === undefined || isStringArray(plan.toolsBeforePlan)) && (plan.planningModel === undefined || isModelSnapshot(plan.planningModel)) && (plan.executionModel === undefined || isModelSnapshot(plan.executionModel)) && typeof plan.widgetCollapsed === "boolean" && typeof plan.awaitingReview === "boolean" && typeof plan.resumeAfterRevision === "boolean" && typeof plan.completionRequested === "boolean" && (plan.closeout === undefined || isCloseout(plan.closeout)); }
function clonePlanState(state: PlanState): PlanState { return { ...state, steps: state.steps.map((step) => ({ ...step })), criteria: [...state.criteria], followUps: [...state.followUps], executionBrief: cloneExecutionBrief(state.executionBrief), workstreams: state.workstreams?.map((stream) => ({ ...stream, stepIds: [...stream.stepIds], ownedPaths: [...stream.ownedPaths] })), parallelRun: state.parallelRun ? { ...state.parallelRun } : undefined, executionSource: state.executionSource ? { ...state.executionSource } : undefined, toolsBeforePlan: state.toolsBeforePlan ? [...state.toolsBeforePlan] : undefined, planningModel: state.planningModel ? { ...state.planningModel } : undefined, executionModel: state.executionModel ? { ...state.executionModel } : undefined, closeout: state.closeout ? { ...state.closeout, verification: [...state.closeout.verification], deviations: [...state.closeout.deviations], nextSteps: [...state.closeout.nextSteps] } : undefined }; }
function cloneExecutionBrief(brief: ExecutionBrief): ExecutionBrief { return { summary: brief.summary, findings: [...brief.findings], decisions: [...brief.decisions], relevantFiles: brief.relevantFiles.map((file) => ({ ...file })), constraints: [...brief.constraints] }; }
function isWorkstreams(value: unknown, steps: TodoItem[]): boolean { if (!Array.isArray(value)) return false; try { const inputs = value.map((stream) => ({ id: (stream as Workstream).id, title: (stream as Workstream).title, objective: (stream as Workstream).objective, steps: (stream as Workstream).stepIds.map((id) => steps.findIndex((step) => step.id === id) + 1), ownedPaths: (stream as Workstream).ownedPaths })); validateWorkstreams(inputs, steps); return true; } catch { return false; } }
function isParallelRunRef(value: unknown): value is NonNullable<PlanState["parallelRun"]> { return !!value && typeof value === "object" && typeof (value as { id?: unknown }).id === "string" && ["provisioning", "awaiting-acknowledgements", "released", "failed", "reported"].includes((value as { phase?: string }).phase ?? ""); }
function isExecutionSource(value: unknown): value is NonNullable<PlanState["executionSource"]> { return !!value && typeof value === "object" && typeof (value as { sessionId?: unknown }).sessionId === "string" && typeof (value as { cwd?: unknown }).cwd === "string" && ((value as { tmuxSession?: unknown }).tmuxSession === undefined || typeof (value as { tmuxSession?: unknown }).tmuxSession === "string"); }
function isModelSnapshot(value: unknown): value is ModelSnapshot { return !!value && typeof value === "object" && typeof (value as ModelSnapshot).provider === "string" && typeof (value as ModelSnapshot).model === "string" && isThinkingLevel((value as ModelSnapshot).thinkingLevel); }
function isCloseout(value: unknown): value is PlanCloseout { return !!value && typeof value === "object" && typeof (value as PlanCloseout).goal === "string" && typeof (value as PlanCloseout).outcome === "string" && typeof (value as PlanCloseout).endState === "string" && isStringArray((value as PlanCloseout).verification) && isStringArray((value as PlanCloseout).deviations) && isStringArray((value as PlanCloseout).nextSteps); }
function isTodoList(value: unknown): value is TodoItem[] { return Array.isArray(value) && value.every((step) => !!step && typeof step === "object" && typeof (step as TodoItem).id === "string" && Number.isInteger((step as TodoItem).step) && typeof (step as TodoItem).text === "string" && typeof (step as TodoItem).completed === "boolean" && typeof (step as TodoItem).skipped === "boolean"); }
function isStringArray(value: unknown): value is string[] { return Array.isArray(value) && value.every((item) => typeof item === "string"); }
function isAccessMode(value: unknown): value is AccessMode { return value === "none" || value === "plan" || value === "read-only"; }
function isPlanPhase(value: unknown): value is PlanPhase { return value === "idle" || value === "drafting" || value === "ready" || value === "revising" || value === "executing" || value === "paused" || value === "handed-off"; }
function isThinkingLevel(value: unknown): value is ThinkingLevel { return value === "off" || value === "minimal" || value === "low" || value === "medium" || value === "high" || value === "xhigh" || value === "max"; }
function validIdentifier(value: string): boolean { return /^[a-z][a-z0-9-]{0,31}$/.test(value); }
function normalizePath(path: string): string { const normalized = path.trim().replace(/^\.\//, "").replace(/\/+$/, ""); if (!normalized || normalized === ".." || normalized.startsWith("../") || normalized.includes("/../")) throw new Error("ownedPaths must be non-empty relative paths."); return normalized; }
function pathsOverlap(left: string, right: string): boolean { return left === right || left.startsWith(`${right}/`) || right.startsWith(`${left}/`); }
