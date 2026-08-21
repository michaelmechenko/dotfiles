// Child-process environment for the Claude Code subprocess, with the
// subscription-first auth policy applied.
//
// The bridge's purpose is routing through the Claude subscription (claude.ai
// OAuth) exactly like interactive Claude Code. If ANTHROPIC_API_KEY or
// ANTHROPIC_AUTH_TOKEN are set in pi's environment, Claude Code uses them and
// bills the Anthropic Console API account (pay-as-you-go) instead of the
// subscription. That surfaces as "Your credit balance is too low to access the
// Anthropic API" when the Console account has no prepaid credit — even though
// the caller is on a healthy Pro subscription.
//
// subscriptionAuth=true (the default) strips both variables from the child env
// so Claude Code falls back to its OAuth subscription login. Set it to false to
// keep routing through an API key.

export function buildChildEnv(
	subscriptionAuth: boolean,
	extra: Record<string, string> = {},
): Record<string, string | undefined> {
	const out: Record<string, string | undefined> = { ...process.env, ...extra };
	if (subscriptionAuth) {
		delete out.ANTHROPIC_API_KEY;
		delete out.ANTHROPIC_AUTH_TOKEN;
	}
	return out;
}
