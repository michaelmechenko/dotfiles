import { randomUUID } from "node:crypto";
import type { TodoItem } from "./utils.ts";

export type AccessMode = "none" | "plan" | "read-only";
export type PlanPhase = "idle" | "drafting" | "ready" | "revising" | "executing" | "paused" | "handed-off";
export type ThinkingLevel = "off" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max";
export interface ModelSnapshot { provider: string; model: string; thinkingLevel: ThinkingLevel; }
export interface ExecutionBrief { summary: string; findings: string[]; decisions: string[]; relevantFiles: { path: string; note: string }[]; constraints: string[]; }
export interface PlanCloseout { goal: string; outcome: string; endState: string; verification: string[]; deviations: string[]; nextSteps: string[]; }
export type CloseoutState = { kind: "idle" } | { kind: "requested"; planId: string; terminalEpoch: number; executionId: string } | { kind: "started"; planId: string; terminalEpoch: number; executionId: string } | { kind: "attention"; planId: string; terminalEpoch: number; executionId: string; reason: "missing-complete" | "archive-failed" | "restored" };
export type ExecutionWaitKind = "input" | "permission" | "external" | "budget";
export interface ExecutionWait { kind: ExecutionWaitKind; reason: string; }
/** Durable bounded recovery state for one approved execution. */
export interface ExecutionContinuation { used: number; lastCheckpoint?: string; waitFor?: ExecutionWait; }
export interface CurrentPaneTransfer { handoffPath: string; transferId: string; saveDefault: boolean; source: { sessionId: string; cwd: string; tmuxSession: string }; planId: string; }
/** Durable source-side detached launch intent, persisted before tmux is awaited. */
export interface DetachedHandoffIntent { handoffPath: string; transferId: string; planId: string; source: { sessionId: string; cwd: string; tmuxSession: string }; sourceLeafId: string; destination: "tmux-pane" | "tmux-window"; launch: { cwd: string; session: string; window: string; pane: string; paneDirection?: "below" | "right" }; }
export interface RecoveryIdentity { handoffPath: string; token: string; planId: string; sourceSessionId: string; }
/** Durable child-side claim ownership; written before readiness acknowledgement. */
export interface ExecutionClaimIdentity { path: string; token: string; }
/** Stops a restored child from regaining execution controls without source recovery. */
export interface OwnershipAttention { reason: "invalid-claim" | "malformed-state"; }
export type TrackedPlanStepInput = string | { id?: string; text: string };
export interface PlanUpdateInput { goal: string; steps: TrackedPlanStepInput[]; criteria?: string[]; followUps?: string[]; executionBrief: ExecutionBrief; }
export interface PlanState {
	version: 7; accessMode: AccessMode; phase: PlanPhase; goal: string; steps: TodoItem[]; criteria: string[]; followUps: string[]; executionBrief: ExecutionBrief;
	planId?: string; createdAt?: string; executionSource?: { sessionId: string; cwd: string; tmuxSession?: string }; handoffPath?: string;
	/** Durable intent and identity for a current-pane session replacement. */
	currentPaneTransfer?: CurrentPaneTransfer;
	/** Durable source ownership for an in-flight detached pane/window launch. */
	detachedHandoff?: DetachedHandoffIntent;
	recovery?: RecoveryIdentity;
	executionClaim?: ExecutionClaimIdentity;
	ownershipAttention?: OwnershipAttention;
	toolsBeforePlan?: string[]; planningModel?: ModelSnapshot; executionModel?: ModelSnapshot; /** Fresh identity for each execution attempt. */ executionId?: string; widgetCollapsed: boolean; awaitingReview: boolean; resumeAfterRevision: boolean;
	terminalEpoch: number; closeoutState: CloseoutState; closeout?: PlanCloseout;
	continuation: ExecutionContinuation;
}
type LegacyPlanState = Omit<Partial<PlanState>, "version" | "executionBrief" | "phase" | "steps"> & { version?: unknown; phase?: string; steps?: Array<Partial<TodoItem>>; completionRequested?: unknown };
const PLAN_ID = /^[A-Za-z0-9_-]+$/;

export function emptyExecutionBrief(): ExecutionBrief { return { summary: "", findings: [], decisions: [], relevantFiles: [], constraints: [] }; }
export function createPlanState(): PlanState { return { version: 7, accessMode: "none", phase: "idle", goal: "", steps: [], criteria: [], followUps: [], executionBrief: emptyExecutionBrief(), widgetCollapsed: true, awaitingReview: false, resumeAfterRevision: false, terminalEpoch: 0, closeoutState: { kind: "idle" }, continuation: { used: 0 } }; }
export function materializePlan(state: PlanState, now = new Date().toISOString()): PlanState { if (!state.steps.length || state.planId) return state; const planId = randomUUID(); const closeoutState = state.closeoutState.kind === "idle" ? state.closeoutState : { ...state.closeoutState, planId }; return { ...state, planId, createdAt: now, closeoutState }; }

/** v2-v6 plans receive deterministic step IDs and a conservative recoverable closeout state. */
export function migratePlanState(data: unknown): PlanState | undefined {
	if (!data || typeof data !== "object") return undefined;
	const legacy = data as LegacyPlanState;
	// Continuation state was added to the v7 workflow record. Existing v7 records
	// without the field receive only the conservative zero-rescue default; a present
	// malformed continuation remains invalid rather than silently being repaired.
	if (legacy.version === 7) {
		const v7 = data as Record<string, unknown>;
		const current = "continuation" in v7 ? data : { ...v7, continuation: { used: 0 } };
		return isPlanState(current) ? clonePlanState(current) : undefined;
	}
	if (legacy.version !== 2 && legacy.version !== 3 && legacy.version !== 4 && legacy.version !== 5 && legacy.version !== 6) return undefined;
	const phase = legacy.phase === "planning" ? "drafting" : legacy.phase ?? "idle";
	const steps = migrateLegacySteps(legacy.version, legacy.steps);
	// v6 had durable step IDs. Do not manufacture replacements for malformed v6
	// input: losing that identity could target the wrong fenced execution step.
	if (!steps) return undefined;
	const executionBrief = isExecutionBrief((legacy as { executionBrief?: unknown }).executionBrief) ? cloneExecutionBrief((legacy as { executionBrief: ExecutionBrief }).executionBrief) : emptyExecutionBrief();
	const base = createPlanState();
	const legacyEpoch = Number.isInteger((legacy as Partial<PlanState>).terminalEpoch) && (legacy as PlanState).terminalEpoch >= 0 ? (legacy as PlanState).terminalEpoch : 0;
	// Copy only the current schema. Historical JSON is untrusted and must never
	// smuggle retired or future fields into the persisted v7 record.
	const source = (legacy as Partial<PlanState>).executionSource;
	const transfer = (legacy as Partial<PlanState>).currentPaneTransfer;
	const detachedHandoff = (legacy as Partial<PlanState>).detachedHandoff;
	const recovery = (legacy as Partial<PlanState>).recovery;
	const executionClaim = (legacy as Partial<PlanState>).executionClaim;
	const ownershipAttention = (legacy as Partial<PlanState>).ownershipAttention;
	const migrated: PlanState = {
		...base,
		accessMode: legacy.version === 2 && (legacy.phase === "planning" || legacy.phase === "revising") ? "plan" : isAccessMode(legacy.accessMode) ? legacy.accessMode : "none",
		phase: isPlanPhase(phase) ? phase : "idle",
		goal: typeof legacy.goal === "string" ? legacy.goal : "",
		steps,
		criteria: isStringArray(legacy.criteria) ? [...legacy.criteria] : [],
		followUps: isStringArray(legacy.followUps) ? [...legacy.followUps] : [],
		executionBrief,
		planId: typeof legacy.planId === "string" && PLAN_ID.test(legacy.planId) ? legacy.planId : undefined,
		createdAt: typeof legacy.createdAt === "string" ? legacy.createdAt : undefined,
		executionSource: isExecutionSource(source) ? { ...source } : undefined,
		handoffPath: typeof legacy.handoffPath === "string" ? legacy.handoffPath : undefined,
		currentPaneTransfer: isCurrentPaneTransfer(transfer) ? { ...transfer, source: { ...transfer.source } } : undefined,
		detachedHandoff: isDetachedHandoffIntent(detachedHandoff) ? { ...detachedHandoff, source: { ...detachedHandoff.source }, launch: { ...detachedHandoff.launch } } : undefined,
		recovery: isRecoveryIdentity(recovery) ? { ...recovery } : undefined,
		executionClaim: isExecutionClaimIdentity(executionClaim) ? { ...executionClaim } : undefined,
		ownershipAttention: isOwnershipAttention(ownershipAttention) ? { ...ownershipAttention } : undefined,
		toolsBeforePlan: isStringArray(legacy.toolsBeforePlan) ? [...legacy.toolsBeforePlan] : undefined,
		planningModel: isModelSnapshot((legacy as Partial<PlanState>).planningModel) ? { ...(legacy as PlanState).planningModel! } : undefined,
		executionModel: isModelSnapshot((legacy as Partial<PlanState>).executionModel) ? { ...(legacy as PlanState).executionModel! } : undefined,
		executionId: typeof (legacy as Partial<PlanState>).executionId === "string" ? (legacy as PlanState).executionId : undefined,
		widgetCollapsed: typeof legacy.widgetCollapsed === "boolean" ? legacy.widgetCollapsed : base.widgetCollapsed,
		awaitingReview: typeof legacy.awaitingReview === "boolean" ? legacy.awaitingReview : false,
		resumeAfterRevision: typeof legacy.resumeAfterRevision === "boolean" ? legacy.resumeAfterRevision : false,
		terminalEpoch: legacyEpoch,
		closeoutState: { kind: "idle" },
		closeout: isCloseout((legacy as Partial<PlanState>).closeout) ? cloneCloseout((legacy as PlanState).closeout!) : undefined,
		continuation: { used: 0 },
	};
	const historicalCloseout = (legacy as Partial<PlanState>).closeoutState;
	if (isCloseoutState(historicalCloseout)) migrated.closeoutState = cloneCloseoutState(historicalCloseout);
	if (migrated.phase === "executing" && legacy.completionRequested === true && !migrated.planId) migrated.planId = randomUUID();
	if (migrated.phase === "executing" && migrated.planId && (legacy.completionRequested === true || (historicalCloseout && typeof historicalCloseout === "object" && (historicalCloseout as { kind?: unknown }).kind !== "idle" && !isCloseoutState(historicalCloseout)))) migrated.closeoutState = { kind: "attention", planId: migrated.planId, terminalEpoch: migrated.terminalEpoch, executionId: closeoutExecutionIdentity(migrated), reason: "restored" };
	// SAFETY: migration receives historical JSON that may carry retired fields outside PlanState.
	const mutableMigrated = migrated as unknown as Record<string, unknown>;
	delete mutableMigrated.completionRequested;
	delete mutableMigrated.workstreams;
	delete mutableMigrated.parallelRun;
	return isPlanState(migrated) ? clonePlanState(migrated) : undefined;
}

function migrateLegacySteps(version: unknown, value: LegacyPlanState["steps"]): TodoItem[] | undefined {
	if (!Array.isArray(value)) return [];
	if (version !== 6) return value.map((step, index) => ({
		id: `legacy-${index + 1}`,
		step: index + 1,
		text: typeof step?.text === "string" ? step.text : "",
		completed: step?.completed === true,
		skipped: step?.completed === true ? false : step?.skipped === true,
	}));
	const ids = new Set<string>();
	const steps: TodoItem[] = [];
	for (const [index, step] of value.entries()) {
		if (!step || typeof step.id !== "string" || !PLAN_ID.test(step.id) || ids.has(step.id) || typeof step.text !== "string" || typeof step.completed !== "boolean" || typeof step.skipped !== "boolean" || (step.completed && step.skipped)) return undefined;
		ids.add(step.id);
		// v6 step numbers were display-only. Preserve the stable ID and status while
		// assigning the canonical sequential numbering required by v7.
		steps.push({ id: step.id, step: index + 1, text: step.text, completed: step.completed, skipped: step.skipped });
	}
	return steps;
}

export function enterRestrictedMode(state: PlanState, accessMode: Exclude<AccessMode, "none">, activeTools: string[]): PlanState {
	if (state.phase === "handed-off") throw new Error("A handed-off plan belongs to its execution session.");
	const toolsBeforePlan = state.accessMode === "none" && !state.toolsBeforePlan ? [...activeTools] : state.toolsBeforePlan;
	let phase = state.phase === "executing" ? "paused" : state.phase;
	if (accessMode === "plan") { if (phase === "idle" || (phase === "paused" && state.steps.length === 0)) phase = "drafting"; else if (phase === "paused" && state.steps.length > 0) phase = "ready"; }
	else if (phase === "drafting" || phase === "ready" || phase === "revising") phase = "paused";
	return { ...state, accessMode, phase, toolsBeforePlan, closeoutState: { kind: "idle" } };
}
export function leaveRestrictedMode(state: PlanState): { state: PlanState; restoreTools?: string[] } { return { state: { ...state, accessMode: "none", toolsBeforePlan: undefined }, restoreTools: state.toolsBeforePlan ? [...state.toolsBeforePlan] : undefined }; }
export function isStepDone(step: TodoItem): boolean { return step.completed || step.skipped; }
export function pendingSteps(state: PlanState): TodoItem[] { return state.steps.filter((step) => !isStepDone(step)); }

export function applyPlanUpdate(state: PlanState, input: PlanUpdateInput): PlanState {
	// Validate and reserve explicit references before deriving any result. This makes
	// rejection atomic and prevents a following legacy string from reusing an ID.
	const explicitIds = new Set<string>();
	for (const entry of input.steps) if (typeof entry !== "string" && entry.id !== undefined) {
		if (!PLAN_ID.test(entry.id) || explicitIds.has(entry.id)) throw new Error(`Tracked plan step ID ${entry.id || "(empty)"} is invalid or duplicated.`);
		explicitIds.add(entry.id);
		if (!state.steps.some((step) => step.id === entry.id)) throw new Error(`Tracked plan step ID ${entry.id} is not in the current plan.`);
	}
	const legacyMatches = new Map<string, TodoItem[]>();
	for (const step of state.steps) {
		if (explicitIds.has(step.id)) continue;
		const key = step.text.trim().toLowerCase(); legacyMatches.set(key, [...(legacyMatches.get(key) ?? []), step]);
	}
	const used = new Set<string>();
	const freshId = () => { let id = randomUUID(); while (used.has(id) || state.steps.some((step) => step.id === id) || explicitIds.has(id)) id = randomUUID(); return id; };
	const steps = input.steps.map((entry, index) => {
		const structured = typeof entry !== "string";
		const text = structured ? entry.text : entry;
		const id = structured ? entry.id : undefined;
		const previous = id ? state.steps.find((step) => step.id === id) : structured ? undefined : legacyMatches.get(text.trim().toLowerCase())?.shift();
		const nextId = previous?.id ?? freshId();
		used.add(nextId);
		return { id: nextId, step: index + 1, text, completed: previous?.completed ?? false, skipped: previous?.skipped ?? false };
	});
	const becameTerminal = steps.length > 0 && steps.every(isStepDone);
	const terminalEpoch = state.terminalEpoch + (becameTerminal && !state.steps.every(isStepDone) ? 1 : 0);
	return { ...state, goal: input.goal, steps, criteria: input.criteria ?? [], followUps: input.followUps ?? [], executionBrief: cloneExecutionBrief(input.executionBrief), phase: state.phase === "drafting" ? "ready" : state.phase, awaitingReview: state.phase === "drafting", terminalEpoch, closeoutState: becameTerminal && state.phase === "executing" ? closeoutForTerminal(state, terminalEpoch) : { kind: "idle" } };
}
export function updatePlanStep(state: PlanState, stepNumber: number, action: "complete" | "uncomplete" | "skip"): PlanState {
	if (!isTodoList(state.steps)) throw new Error("plan_step requires a valid tracked plan.");
	if (!state.steps.some((step) => step.step === stepNumber)) throw new Error("plan_step requires a valid step.");
	const steps = state.steps.map((step) => step.step !== stepNumber ? { ...step } : { ...step, completed: action === "complete", skipped: action === "skip" });
	const terminal = steps.length > 0 && steps.every(isStepDone);
	const epoch = state.terminalEpoch + (terminal && !state.steps.every(isStepDone) ? 1 : 0);
	return { ...state, steps, terminalEpoch: epoch, closeoutState: terminal && state.phase === "executing" ? closeoutForTerminal(state, epoch) : { kind: "idle" } };
}
function closeoutForTerminal(state: PlanState, terminalEpoch: number): CloseoutState {
	if (!state.planId) return { kind: "idle" };
	// A harmless plan_update while terminal must not restart closeout delivery.
	if (state.closeoutState.kind !== "idle" && state.closeoutState.planId === state.planId && state.closeoutState.terminalEpoch === terminalEpoch) return state.closeoutState;
	return { kind: "requested", planId: state.planId, terminalEpoch, executionId: closeoutExecutionIdentity(state) };
}
export function closeoutExecutionIdentity(state: PlanState): string { return state.executionId ?? `${state.executionSource?.sessionId ?? "local"}:${state.executionModel?.provider ?? ""}/${state.executionModel?.model ?? ""}:${state.createdAt ?? ""}`; }
export function canClosePlan(state: PlanState): boolean { return state.phase === "executing" && state.steps.length > 0 && state.steps.every(isStepDone); }
export function closeoutMatches(state: PlanState): boolean { return state.closeoutState.kind !== "idle" && state.closeoutState.planId === state.planId && state.closeoutState.terminalEpoch === state.terminalEpoch && state.closeoutState.executionId === closeoutExecutionIdentity(state); }
export function isExecutionBrief(value: unknown): value is ExecutionBrief { if (!value || typeof value !== "object") return false; const brief = value as Partial<ExecutionBrief>; return typeof brief.summary === "string" && isStringArray(brief.findings) && isStringArray(brief.decisions) && isStringArray(brief.constraints) && Array.isArray(brief.relevantFiles) && brief.relevantFiles.every((file) => !!file && typeof file === "object" && typeof (file as { path?: unknown }).path === "string" && typeof (file as { note?: unknown }).note === "string"); }
export function isPlanState(value: unknown): value is PlanState { if (!value || typeof value !== "object") return false; const p = value as Partial<PlanState>; return p.version === 7 && isAccessMode(p.accessMode) && isPlanPhase(p.phase) && typeof p.goal === "string" && isTodoList(p.steps) && isStringArray(p.criteria) && isStringArray(p.followUps) && isExecutionBrief(p.executionBrief) && (p.planId === undefined || (typeof p.planId === "string" && PLAN_ID.test(p.planId))) && (p.createdAt === undefined || typeof p.createdAt === "string") && (p.executionSource === undefined || isExecutionSource(p.executionSource)) && (p.handoffPath === undefined || typeof p.handoffPath === "string") && (p.currentPaneTransfer === undefined || isCurrentPaneTransfer(p.currentPaneTransfer)) && (p.detachedHandoff === undefined || isDetachedHandoffIntent(p.detachedHandoff)) && (p.recovery === undefined || isRecoveryIdentity(p.recovery)) && (p.executionClaim === undefined || isExecutionClaimIdentity(p.executionClaim)) && (p.ownershipAttention === undefined || isOwnershipAttention(p.ownershipAttention)) && (p.toolsBeforePlan === undefined || isStringArray(p.toolsBeforePlan)) && (p.planningModel === undefined || isModelSnapshot(p.planningModel)) && (p.executionModel === undefined || isModelSnapshot(p.executionModel)) && (p.executionId === undefined || typeof p.executionId === "string") && typeof p.widgetCollapsed === "boolean" && typeof p.awaitingReview === "boolean" && typeof p.resumeAfterRevision === "boolean" && Number.isInteger(p.terminalEpoch) && (p.terminalEpoch ?? -1) >= 0 && isCloseoutState(p.closeoutState) && (p.closeout === undefined || isCloseout(p.closeout)) && isExecutionContinuation(p.continuation); }
export function clonePlanState(s: PlanState): PlanState { return { version: 7, accessMode: s.accessMode, phase: s.phase, goal: s.goal, steps: s.steps.map((step) => ({ ...step })), criteria: [...s.criteria], followUps: [...s.followUps], executionBrief: cloneExecutionBrief(s.executionBrief), planId: s.planId, createdAt: s.createdAt, executionSource: s.executionSource ? { ...s.executionSource } : undefined, handoffPath: s.handoffPath, currentPaneTransfer: s.currentPaneTransfer ? { ...s.currentPaneTransfer, source: { ...s.currentPaneTransfer.source } } : undefined, detachedHandoff: s.detachedHandoff ? { ...s.detachedHandoff, source: { ...s.detachedHandoff.source }, launch: { ...s.detachedHandoff.launch } } : undefined, recovery: s.recovery ? { ...s.recovery } : undefined, executionClaim: s.executionClaim ? { ...s.executionClaim } : undefined, ownershipAttention: s.ownershipAttention ? { ...s.ownershipAttention } : undefined, toolsBeforePlan: s.toolsBeforePlan ? [...s.toolsBeforePlan] : undefined, planningModel: s.planningModel ? { ...s.planningModel } : undefined, executionModel: s.executionModel ? { ...s.executionModel } : undefined, executionId: s.executionId, widgetCollapsed: s.widgetCollapsed, awaitingReview: s.awaitingReview, resumeAfterRevision: s.resumeAfterRevision, terminalEpoch: s.terminalEpoch, closeoutState: cloneCloseoutState(s.closeoutState), closeout: s.closeout ? { ...s.closeout, verification: [...s.closeout.verification], deviations: [...s.closeout.deviations], nextSteps: [...s.closeout.nextSteps] } : undefined, continuation: cloneExecutionContinuation(s.continuation) }; }
function cloneExecutionBrief(b: ExecutionBrief): ExecutionBrief { return { summary: b.summary, findings: [...b.findings], decisions: [...b.decisions], relevantFiles: b.relevantFiles.map((file) => ({ ...file })), constraints: [...b.constraints] }; }
function cloneCloseout(closeout: PlanCloseout): PlanCloseout { return { ...closeout, verification: [...closeout.verification], deviations: [...closeout.deviations], nextSteps: [...closeout.nextSteps] }; }
function cloneCloseoutState(s: CloseoutState): CloseoutState { return s.kind === "idle" ? s : { ...s }; }
function cloneExecutionContinuation(value: ExecutionContinuation): ExecutionContinuation { return { used: value.used, ...(value.lastCheckpoint ? { lastCheckpoint: value.lastCheckpoint } : {}), ...(value.waitFor ? { waitFor: { ...value.waitFor } } : {}) }; }
function isExecutionContinuation(value: unknown): value is ExecutionContinuation { if (!value || typeof value !== "object") return false; const continuation = value as Partial<ExecutionContinuation>; return Number.isInteger(continuation.used) && (continuation.used ?? -1) >= 0 && (continuation.used ?? Infinity) <= 32 && (continuation.lastCheckpoint === undefined || (typeof continuation.lastCheckpoint === "string" && continuation.lastCheckpoint.length > 0)) && (continuation.waitFor === undefined || isExecutionWait(continuation.waitFor)); }
export function isExecutionWait(value: unknown): value is ExecutionWait { return !!value && typeof value === "object" && ((value as ExecutionWait).kind === "input" || (value as ExecutionWait).kind === "permission" || (value as ExecutionWait).kind === "external" || (value as ExecutionWait).kind === "budget") && typeof (value as ExecutionWait).reason === "string" && (value as ExecutionWait).reason.trim().length > 0; }
function isCurrentPaneTransfer(v: unknown): v is CurrentPaneTransfer { return !!v && typeof v === "object" && typeof (v as CurrentPaneTransfer).handoffPath === "string" && typeof (v as CurrentPaneTransfer).transferId === "string" && typeof (v as CurrentPaneTransfer).saveDefault === "boolean" && typeof (v as CurrentPaneTransfer).planId === "string" && isExecutionSource((v as CurrentPaneTransfer).source) && typeof (v as CurrentPaneTransfer).source.tmuxSession === "string"; }
function isDetachedHandoffIntent(v: unknown): v is DetachedHandoffIntent { if (!v || typeof v !== "object") return false; const intent = v as DetachedHandoffIntent; return typeof intent.handoffPath === "string" && intent.handoffPath.length > 0 && typeof intent.transferId === "string" && intent.transferId.length > 0 && typeof intent.planId === "string" && PLAN_ID.test(intent.planId) && isExecutionSource(intent.source) && typeof intent.source.tmuxSession === "string" && typeof intent.sourceLeafId === "string" && intent.sourceLeafId.length > 0 && (intent.destination === "tmux-pane" || intent.destination === "tmux-window") && !!intent.launch && typeof intent.launch.cwd === "string" && typeof intent.launch.session === "string" && typeof intent.launch.window === "string" && typeof intent.launch.pane === "string" && (intent.launch.paneDirection === undefined || intent.launch.paneDirection === "below" || intent.launch.paneDirection === "right"); }
function isOwnershipAttention(v: unknown): v is OwnershipAttention { return !!v && typeof v === "object" && ((v as OwnershipAttention).reason === "invalid-claim" || (v as OwnershipAttention).reason === "malformed-state"); }
function isRecoveryIdentity(v: unknown): v is RecoveryIdentity { return !!v && typeof v === "object" && typeof (v as RecoveryIdentity).handoffPath === "string" && typeof (v as RecoveryIdentity).token === "string" && typeof (v as RecoveryIdentity).planId === "string" && typeof (v as RecoveryIdentity).sourceSessionId === "string"; }
function isExecutionClaimIdentity(v: unknown): v is ExecutionClaimIdentity { return !!v && typeof v === "object" && typeof (v as ExecutionClaimIdentity).path === "string" && typeof (v as ExecutionClaimIdentity).token === "string" && (v as ExecutionClaimIdentity).path.length > 0 && (v as ExecutionClaimIdentity).token.length > 0; }
function isExecutionSource(v: unknown): v is NonNullable<PlanState["executionSource"]> { return !!v && typeof v === "object" && typeof (v as { sessionId?: unknown }).sessionId === "string" && typeof (v as { cwd?: unknown }).cwd === "string" && ((v as { tmuxSession?: unknown }).tmuxSession === undefined || typeof (v as { tmuxSession?: unknown }).tmuxSession === "string"); }
function isModelSnapshot(v: unknown): v is ModelSnapshot { return !!v && typeof v === "object" && typeof (v as ModelSnapshot).provider === "string" && typeof (v as ModelSnapshot).model === "string" && isThinkingLevel((v as ModelSnapshot).thinkingLevel); }
function isCloseout(v: unknown): v is PlanCloseout { return !!v && typeof v === "object" && typeof (v as PlanCloseout).goal === "string" && typeof (v as PlanCloseout).outcome === "string" && typeof (v as PlanCloseout).endState === "string" && isStringArray((v as PlanCloseout).verification) && isStringArray((v as PlanCloseout).deviations) && isStringArray((v as PlanCloseout).nextSteps); }
function isCloseoutState(v: unknown): v is CloseoutState { if (!v || typeof v !== "object" || typeof (v as { kind?: unknown }).kind !== "string") return false; const s = v as Partial<CloseoutState>; return s.kind === "idle" || ((s.kind === "requested" || s.kind === "started" || s.kind === "attention") && typeof s.planId === "string" && Number.isInteger(s.terminalEpoch) && typeof s.executionId === "string" && (s.kind !== "attention" || s.reason === "missing-complete" || s.reason === "archive-failed" || s.reason === "restored")); }
function isTodoList(v: unknown): v is TodoItem[] { if (!Array.isArray(v)) return false; const ids = new Set<string>(); const numbers = new Set<number>(); return v.every((step, index) => { if (!step || typeof step !== "object") return false; const item = step as TodoItem; if (!PLAN_ID.test(item.id) || ids.has(item.id) || !Number.isInteger(item.step) || item.step !== index + 1 || numbers.has(item.step) || typeof item.text !== "string" || typeof item.completed !== "boolean" || typeof item.skipped !== "boolean" || (item.completed && item.skipped)) return false; ids.add(item.id); numbers.add(item.step); return true; }); }
function isStringArray(v: unknown): v is string[] { return Array.isArray(v) && v.every((item) => typeof item === "string"); }
function isAccessMode(v: unknown): v is AccessMode { return v === "none" || v === "plan" || v === "read-only"; }
function isPlanPhase(v: unknown): v is PlanPhase { return v === "idle" || v === "drafting" || v === "ready" || v === "revising" || v === "executing" || v === "paused" || v === "handed-off"; }
function isThinkingLevel(v: unknown): v is ThinkingLevel { return v === "off" || v === "minimal" || v === "low" || v === "medium" || v === "high" || v === "xhigh" || v === "max"; }
