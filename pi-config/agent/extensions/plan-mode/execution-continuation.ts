import type { ExecutionContinuation } from "./plan-state.ts";

export const MAX_EXECUTION_RESCUES = 32;

export type ContinuationDecision =
	| { kind: "none" }
	| { kind: "continue"; continuation: ExecutionContinuation }
	| { kind: "wait"; continuation: ExecutionContinuation };

export interface ContinuationBoundary {
	checkpoint?: string;
	canContinue: boolean;
	pendingMessages: boolean;
	alreadyContinuing: boolean;
	completed: boolean;
	eligible: boolean;
}

/**
 * Decides one bounded rescue for a distinct ordinary-tool checkpoint. The caller
 * owns transcript inspection and persistence; this module cannot schedule work.
 */
export function decideExecutionContinuation(current: ExecutionContinuation, boundary: ContinuationBoundary): ContinuationDecision {
	if (!boundary.eligible || !boundary.completed || !boundary.canContinue || boundary.pendingMessages || boundary.alreadyContinuing || !boundary.checkpoint || current.waitFor) return { kind: "none" };
	if (current.used >= MAX_EXECUTION_RESCUES) return {
		kind: "wait",
		continuation: { ...current, lastCheckpoint: boundary.checkpoint, waitFor: { kind: "budget", reason: `Automatic continuation limit (${MAX_EXECUTION_RESCUES}) reached; choose Resume, recalibrate, or pause.` } },
	};
	if (current.lastCheckpoint === boundary.checkpoint) return {
		kind: "wait",
		continuation: { ...current, waitFor: { kind: "external", reason: "The execution stopped without new ordinary-tool progress; choose Resume, recalibrate, adjust statuses, or pause." } },
	};
	return { kind: "continue", continuation: { used: current.used + 1, lastCheckpoint: boundary.checkpoint } };
}

export function resetExecutionContinuation(): ExecutionContinuation {
	return { used: 0 };
}
