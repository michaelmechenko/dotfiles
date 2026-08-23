// Pure retry policy for a Claude Code provider attempt.
//
// The transition is a server-side OAuth billing handoff that sometimes rejects
// a request before Claude receives it. Keep recognition and safety conditions
// together so callers cannot accidentally retry a turn with model/tool effects.

export const EXTRA_USAGE_TRANSITION = "Third-party apps now draw from your extra usage, not your plan limits.";

export function isExtraUsageTransitionText(text: string): boolean {
	return text.includes(EXTRA_USAGE_TRANSITION);
}

/** Claude Code's completed assistant wrapper for the pre-execution 400. */
export function isExtraUsageTransitionBanner(text: string): boolean {
	return /^(?:Error:\s*)?API Error:\s*400\b/.test(text.trim()) && isExtraUsageTransitionText(text);
}

export type ProviderAttempt = {
	attempt: number;
	error?: string;
	usage?: { input?: number; output?: number; cacheRead?: number; cacheWrite?: number; totalTokens?: number };
	sawAssistantContent: boolean;
	sawToolCall: boolean;
};

/** True only for the known, pre-execution OAuth billing transition. */
export function shouldRetryExtraUsageTransition(attempt: ProviderAttempt): boolean {
	if (attempt.attempt !== 0 || !attempt.error || !isExtraUsageTransitionText(attempt.error)) return false;
	if (attempt.sawAssistantContent || attempt.sawToolCall) return false;
	const usage = attempt.usage;
	return !usage || (
		(usage.input ?? 0) === 0 &&
		(usage.output ?? 0) === 0 &&
		(usage.cacheRead ?? 0) === 0 &&
		(usage.cacheWrite ?? 0) === 0 &&
		(usage.totalTokens ?? 0) === 0
	);
}
