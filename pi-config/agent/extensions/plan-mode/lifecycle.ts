import { enterRestrictedMode, materializePlan, type CloseoutState, type ModelSnapshot, type PlanState } from "./plan-state.ts";
import { resetExecutionContinuation } from "./execution-continuation.ts";
import { PLAN_EXECUTION_TOOLS, restrictedTools } from "./restricted-mode.ts";

export interface RestoredLifecycle {
	state: PlanState;
	tools: string[];
	model?: ModelSnapshot;
}

/** A captured operation is valid only on the same session and branch generation. */
export interface LifecycleToken {
	generation: number;
	sessionId: string;
	leafId: string;
}

/**
 * Tracks session/branch navigation independently from ordinary branch appends.
 * A current branch which still contains the captured leaf is an append; changing
 * to an ancestor or sibling advances the generation and fences pending effects.
 */
export class PlanLifecycle {
	#generation = 0;
	#sessionId = "";
	#leafId = "";

	startSession(sessionId: string, leafId: string): void {
		this.#generation++;
		this.#sessionId = sessionId;
		this.#leafId = leafId;
	}

	observeBranch(sessionId: string, leafId: string, branchIds: string[]): boolean {
		const navigated = sessionId !== this.#sessionId || (!this.#leafId ? false : !branchIds.includes(this.#leafId));
		if (navigated) this.#generation++;
		this.#sessionId = sessionId;
		this.#leafId = leafId;
		return navigated;
	}

	invalidate(): void { this.#generation++; }
	capture(): LifecycleToken { return { generation: this.#generation, sessionId: this.#sessionId, leafId: this.#leafId }; }
	isCurrent(token: LifecycleToken, sessionId: string, branchIds: string[]): boolean {
		return token.generation === this.#generation && token.sessionId === sessionId && branchIds.includes(token.leafId);
	}
}

/** Serializes only synchronous state/file commits; never await UI, model, or session work inside it. */
export class PlanMutationQueue {
	#pending: Array<{ mutation: () => unknown; resolve: (value: unknown) => void; reject: (error: unknown) => void }> = [];
	#scheduled = false;
	run<T>(mutation: () => T, priority: "user" | "tool" = "user"): Promise<T> {
		return new Promise<T>((resolve, reject) => {
			const entry = { mutation, resolve: resolve as (value: unknown) => void, reject };
			if (priority === "user") this.#pending.unshift(entry);
			else this.#pending.push(entry);
			if (!this.#scheduled) { this.#scheduled = true; queueMicrotask(() => this.drain()); }
		});
	}
	private drain(): void {
		this.#scheduled = false;
		while (this.#pending.length) {
			const entry = this.#pending.shift()!;
			try { entry.resolve(entry.mutation()); } catch (error) { entry.reject(error); }
		}
	}
}

/** Compatibility helper for callers that have no branch token. */
export function lifecycleGuard(revision: number, sessionId: string, currentRevision: number, currentSessionId: string): boolean {
	return revision === currentRevision && sessionId === currentSessionId;
}

export type LifecycleTransition =
	| { type: "enter"; mode: "plan" | "read-only"; activeTools: string[]; planningModel?: ModelSnapshot }
	| { type: "pause" }
	| { type: "revise" }
	| { type: "execute"; model: ModelSnapshot; source: NonNullable<PlanState["executionSource"]>; executionId: string; planningModel?: ModelSnapshot; resetContinuation?: boolean }
	| { type: "closeout"; state: CloseoutState }
	| { type: "restore"; restored: PlanState };

/** Pure state decisions for all plan lifecycle edges; callers own effects and persistence. */
export function transitionPlanLifecycle(state: PlanState, transition: LifecycleTransition): PlanState {
	switch (transition.type) {
		case "enter": {
			const next = enterRestrictedMode(state, transition.mode, transition.activeTools);
			return transition.mode === "plan" && !next.planningModel && transition.planningModel ? { ...next, planningModel: transition.planningModel } : next;
		}
		case "pause":
			return { ...state, phase: "paused", accessMode: "none", awaitingReview: false, resumeAfterRevision: false };
		case "revise":
			return { ...state, phase: "revising", accessMode: "plan", awaitingReview: false, resumeAfterRevision: true, closeoutState: { kind: "idle" } };
		case "execute":
			return {
				...state,
				planningModel: state.planningModel ?? transition.planningModel,
				phase: "executing", accessMode: "none", executionModel: transition.model, executionSource: transition.source,
				executionId: transition.executionId, awaitingReview: false, resumeAfterRevision: false, closeoutState: { kind: "idle" },
				continuation: transition.resetContinuation === false ? state.continuation : resetExecutionContinuation(),
			};
		case "closeout":
			return { ...state, closeoutState: transition.state };
		case "restore":
			return materializePlan(transition.restored);
	}
}

/** Derive the complete branch-local plan activation without mutating either snapshot. */
export function restorePlanLifecycle(_previous: PlanState, restored: PlanState, currentTools: string[], availableTools: string[]): RestoredLifecycle {
	let state = transitionPlanLifecycle(_previous, { type: "restore", restored });
	if (state.accessMode !== "none" && !state.toolsBeforePlan) state = { ...state, toolsBeforePlan: [...currentTools] };
	let tools: string[];
	if (state.ownershipAttention) tools = [...(state.toolsBeforePlan ?? currentTools)].filter((name) => availableTools.includes(name) && !PLAN_EXECUTION_TOOLS.includes(name));
	else if (state.accessMode !== "none") tools = restrictedTools(state.accessMode, state.toolsBeforePlan ?? currentTools, availableTools);
	else if (state.phase === "executing") tools = [...new Set([...(state.toolsBeforePlan ?? currentTools), ...PLAN_EXECUTION_TOOLS])].filter((name) => availableTools.includes(name));
	else tools = [...(state.toolsBeforePlan ?? currentTools)].filter((name) => availableTools.includes(name) && !PLAN_EXECUTION_TOOLS.includes(name));
	const model = state.ownershipAttention ? state.planningModel : state.phase === "executing" ? state.executionModel : state.planningModel;
	return { state, tools: [...new Set(tools)], model };
}
