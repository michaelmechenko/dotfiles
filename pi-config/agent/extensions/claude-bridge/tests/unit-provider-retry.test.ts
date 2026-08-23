import { test } from "node:test";
import assert from "node:assert/strict";
import { EXTRA_USAGE_TRANSITION, isExtraUsageTransitionBanner, shouldRetryExtraUsageTransition } from "../src/provider-retry.ts";
import { __test } from "../src/index.ts";
import { QueryContext } from "../src/query-state.ts";

const transition = { error: `API Error: 400 ${EXTRA_USAGE_TRANSITION} Add more at claude.ai/settings/usage and keep going.`, usage: { totalTokens: 0 }, sawAssistantContent: false, sawToolCall: false };

test("retries the exact pre-execution extra-usage transition once", () => {
	assert.equal(shouldRetryExtraUsageTransition({ attempt: 0, ...transition }), true);
	assert.equal(shouldRetryExtraUsageTransition({ attempt: 1, ...transition }), false);
});

test("buffers only Claude Code's API-error wrapper, not model text quoting the transition", () => {
	assert.equal(isExtraUsageTransitionBanner(transition.error), true);
	assert.equal(isExtraUsageTransitionBanner(`The server said: ${EXTRA_USAGE_TRANSITION}`), false);
});

for (const [name, attempt] of [
	["generic error", { attempt: 0, ...transition, error: "API Error: 400 invalid request" }],
	["out-of-extra-usage error", { attempt: 0, ...transition, error: "You're out of extra usage" }],
	["nonzero usage", { attempt: 0, ...transition, usage: { input: 1, totalTokens: 1 } }],
	["assistant content", { attempt: 0, ...transition, sawAssistantContent: true }],
	["tool call", { attempt: 0, ...transition, sawToolCall: true }],
] as const) {
	test(`does not retry ${name}`, () => assert.equal(shouldRetryExtraUsageTransition(attempt), false));
}

function scriptedTransitionQuery() {
	return {
		async *[Symbol.asyncIterator]() {
			yield { type: "system", subtype: "init", session_id: "transition-session" };
			yield {
				type: "assistant",
				message: { role: "assistant", content: [{ type: "text", text: transition.error }] },
			};
			yield { type: "result", subtype: "success", is_error: true, result: transition.error };
		},
	} as any;
}

function retryContext() {
	const events: any[] = [];
	const model = {
		id: "claude-sonnet-5", api: "claude-bridge", provider: "claude-bridge",
		cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
	} as any;
	const context = new QueryContext();
	context.currentPiStream = { push: (event: any) => events.push(event), end() {} } as any;
	context.resetTurnState(model);
	return { context, events, model };
}

test("consumeQuery suppresses the observed assistant-form transition and requests one retry", async () => {
	const { context, events, model } = retryContext();
	const outcome = await __test.consumeQuery(scriptedTransitionQuery(), new Map(), model, () => false, context, 0);
	assert.deepEqual(outcome, { capturedSessionId: "transition-session", retryExtraUsage: true });
	assert.deepEqual(events, []);
});

test("consumeQuery surfaces the assistant-form transition after the retry is exhausted", async () => {
	const { context, events, model } = retryContext();
	const outcome = await __test.consumeQuery(scriptedTransitionQuery(), new Map(), model, () => false, context, 1);
	assert.deepEqual(outcome, { capturedSessionId: "transition-session", retryExtraUsage: false });
	assert.equal(events.some((event) => event.type === "text_delta" && event.delta.includes(EXTRA_USAGE_TRANSITION)), true);
});
