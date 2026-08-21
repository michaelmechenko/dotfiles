// Prompt-capture fallback tests for the claude-bridge local fork.
// Covers the plan-mode / triggerTurn custom-message case: pi can trigger a turn
// without ever emitting before_agent_start, so the bridge's provider stream sees
// a system prompt no PromptCaptures instance ever recorded.
// Run: npm test (in extensions/claude-bridge) or
//   node --experimental-strip-types --no-warnings --test tests/unit-prompt-capture.test.ts

import { test } from "node:test";
import assert from "node:assert/strict";
import { PromptCaptures, projectPromptCapture } from "../src/prompt-capture.ts";

test("resolveOrDerive falls back to verbatim custom text for a wholly unknown prompt, instead of throwing", () => {
	const captures = new PromptCaptures();
	// Nothing was ever recorded — the plan-mode execution-kickoff shape: pi
	// triggered a turn via sendMessage({ triggerTurn: true }), which never runs
	// before_agent_start, so the provider sees a system prompt with zero known captures.
	const unknownPrompt = "you are pi, a coding assistant.\n\n[PLAN EXECUTION]\nStart executing the handed-off plan...";

	const originalError = console.error;
	const errors: unknown[][] = [];
	console.error = (...args: unknown[]) => errors.push(args);
	let capture;
	try {
		capture = captures.resolveOrDerive(unknownPrompt);
	} finally {
		console.error = originalError;
	}

	assert.ok(capture, "must return a capture, not throw");
	assert.equal(capture!.custom, unknownPrompt, "the full prompt must be forwarded verbatim");
	assert.deepEqual(capture!.inherited, []);
	assert.equal(errors.length, 1, "must warn once instead of failing the turn");
	assert.match(String(errors[0]![0]), /no capture for this/);

	const projected = projectPromptCapture(capture!, { skillReadTool: "none" });
	assert.equal(projected, unknownPrompt, "projection must not drop or alter any instruction text");
});

test("resolveOrDerive still prefers an exact match over the fallback", () => {
	const captures = new PromptCaptures();
	const prompt = "known system prompt";
	captures.record(prompt, { custom: "custom text", contextFiles: [], skills: [] });

	const capture = captures.resolveOrDerive(prompt);
	assert.equal(capture!.custom, "custom text");
});

test("resolveOrDerive still resolves an embedding prompt via the inheritance path (not the raw fallback)", () => {
	const captures = new PromptCaptures();
	const parentPrompt = "parent assembled prompt";
	captures.record(parentPrompt, { custom: "parent custom", contextFiles: [], skills: [] });

	const wrapped = `wrapper prefix\n${parentPrompt}\nwrapper suffix`;
	const capture = captures.resolveOrDerive(wrapped);
	assert.equal(capture!.inherited.length, 1, "must resolve via the embedding path, not the unknown-prompt fallback");
	assert.equal(capture!.inherited[0]!.parent.custom, "parent custom");
});
