// Routing-policy tests for the claude-bridge local fork.
// Pure module tests — no pi packages resolved, no live API calls.
// Run: npm test (in extensions/claude-bridge) or
//   node --experimental-strip-types --no-warnings --test tests/unit-routing.test.ts

import { test } from "node:test";
import assert from "node:assert/strict";
import { resolveClaudeCodeRuntimeModel, claudeCodeModelId, applyLongContext, type LongContextSettings } from "../src/models.ts";
import { buildChildEnv } from "../src/env.ts";

const pro: LongContextSettings = { plan: "pro", longContextExtraUsage: false };
const proExtra: LongContextSettings = { plan: "pro", longContextExtraUsage: true };
const max: LongContextSettings = { plan: "max", longContextExtraUsage: false };

test("opus-5: Pro without extra usage routes to bare 200K, never the credit-gated [1m]", () => {
	assert.deepEqual(resolveClaudeCodeRuntimeModel("claude-opus-5", pro), {
		cliModelId: "claude-opus-5",
		contextWindow: 200_000,
	});
	assert.deepEqual(resolveClaudeCodeRuntimeModel("claude-opus-5", proExtra), {
		cliModelId: "claude-opus-5[1m]",
		contextWindow: 1_000_000,
	});
	assert.deepEqual(resolveClaudeCodeRuntimeModel("claude-opus-5", max), {
		cliModelId: "claude-opus-5[1m]",
		contextWindow: 1_000_000,
	});
});

test("opus 4.8: Pro [1m] is credit-gated; bare is 200k; Max/extra-usage get 1m", () => {
	assert.deepEqual(resolveClaudeCodeRuntimeModel("claude-opus-4-8", pro), {
		cliModelId: "claude-opus-4-8",
		contextWindow: 200_000,
	});
	assert.deepEqual(resolveClaudeCodeRuntimeModel("claude-opus-4-8", proExtra), {
		cliModelId: "claude-opus-4-8[1m]",
		contextWindow: 1_000_000,
	});
	assert.deepEqual(resolveClaudeCodeRuntimeModel("claude-opus-4-8", max), {
		cliModelId: "claude-opus-4-8[1m]",
		contextWindow: 1_000_000,
	});
});

test("opus 4.7: measured 1m everywhere, including Pro without extra usage", () => {
	assert.deepEqual(resolveClaudeCodeRuntimeModel("claude-opus-4-7", pro), {
		cliModelId: "claude-opus-4-7",
		contextWindow: 1_000_000,
	});
});

test("opus 4.6: unchanged — bare 200k on Pro, 1m on Max or extra usage", () => {
	assert.deepEqual(resolveClaudeCodeRuntimeModel("claude-opus-4-6", pro), {
		cliModelId: "claude-opus-4-6",
		contextWindow: 200_000,
	});
	assert.deepEqual(resolveClaudeCodeRuntimeModel("claude-opus-4-6", max), {
		cliModelId: "claude-opus-4-6[1m]",
		contextWindow: 1_000_000,
	});
});

test("sonnet 5: 1m is plan-included on Pro — always requests [1m]", () => {
	assert.deepEqual(resolveClaudeCodeRuntimeModel("claude-sonnet-5", pro), {
		cliModelId: "claude-sonnet-5[1m]",
		contextWindow: 1_000_000,
	});
	assert.deepEqual(resolveClaudeCodeRuntimeModel("claude-sonnet-5", max), {
		cliModelId: "claude-sonnet-5[1m]",
		contextWindow: 1_000_000,
	});
});

test("sonnet 4.6 / haiku 4.5: 200k unless extra usage / never 1m", () => {
	assert.deepEqual(resolveClaudeCodeRuntimeModel("claude-sonnet-4-6", pro), {
		cliModelId: "claude-sonnet-4-6",
		contextWindow: 200_000,
	});
	assert.deepEqual(resolveClaudeCodeRuntimeModel("claude-sonnet-4-6", proExtra), {
		cliModelId: "claude-sonnet-4-6[1m]",
		contextWindow: 1_000_000,
	});
	assert.deepEqual(resolveClaudeCodeRuntimeModel("claude-haiku-4-5", pro), {
		cliModelId: "claude-haiku-4-5",
		contextWindow: 200_000,
	});
});

test("fable 5: 1m on all plans (measured Pro included); caveat documented", () => {
	assert.deepEqual(resolveClaudeCodeRuntimeModel("claude-fable-5", pro), {
		cliModelId: "claude-fable-5[1m]",
		contextWindow: 1_000_000,
	});
});

test("claudeCodeModelId maps through the same policy", () => {
	assert.equal(claudeCodeModelId({ id: "claude-opus-5" }, pro), "claude-opus-5");
	assert.equal(claudeCodeModelId({ id: "claude-opus-5" }, max), "claude-opus-5[1m]");
	assert.equal(claudeCodeModelId({ id: "claude-sonnet-5" }, pro), "claude-sonnet-5[1m]");
});

test("applyLongContext labels 1m models and reports 200k windows", () => {
	const models = [{ id: "claude-opus-5", name: "Opus 5", contextWindow: 1_000_000 }];
	const proModels = applyLongContext(models, pro);
	assert.equal(proModels[0].contextWindow, 200_000);
	assert.equal(proModels[0].name, "Opus 5");
	const maxModels = applyLongContext(models, max);
	assert.equal(maxModels[0].contextWindow, 1_000_000);
	assert.match(maxModels[0].name, /1M/);
});

test("buildChildEnv strips API-key auth when subscriptionAuth is on (default), preserves it when off", () => {
	process.env.ANTHROPIC_API_KEY = "sk-ant-test";
	process.env.ANTHROPIC_AUTH_TOKEN = "token-test";
	process.env.UNRELATED_VAR = "keep";
	const stripped = buildChildEnv(true, { DISABLE_AUTO_COMPACT: "1" });
	assert.equal(stripped.ANTHROPIC_API_KEY, undefined);
	assert.equal(stripped.ANTHROPIC_AUTH_TOKEN, undefined);
	assert.equal(stripped.UNRELATED_VAR, "keep");
	assert.equal(stripped.DISABLE_AUTO_COMPACT, "1");
	const kept = buildChildEnv(false, {});
	assert.equal(kept.ANTHROPIC_API_KEY, "sk-ant-test");
	assert.equal(kept.ANTHROPIC_AUTH_TOKEN, "token-test");
	delete process.env.ANTHROPIC_API_KEY;
	delete process.env.ANTHROPIC_AUTH_TOKEN;
	delete process.env.UNRELATED_VAR;
});
