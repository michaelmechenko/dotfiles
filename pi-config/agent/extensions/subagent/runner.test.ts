import assert from "node:assert/strict";
import test from "node:test";
import { appendOutputBounded, createRunnerState, JsonlDecoder, MAX_EVENT_LINE_BYTES, reduceEvent, runSpawnedJsonl, truncateUtf8 } from "./runner.ts";

test("reducer projects current tool, usage, retries, and terminal settle", () => {
	const state = createRunnerState();
	reduceEvent(state, { type: "agent_start" });
	reduceEvent(state, { type: "tool_execution_start", toolName: "webfetch" });
	assert.equal(state.activeTool, "webfetch");
	reduceEvent(state, { type: "auto_retry_start", attempt: 2 });
	assert.equal(state.state, "retrying");
	reduceEvent(state, { type: "message_end", message: { role: "assistant", model: "test/model", stopReason: "end", content: [], usage: { input: 10, output: 4, totalTokens: 14, cost: { total: 0.1 } } } });
	assert.equal(state.usage.turns, 1);
	assert.equal(state.usage.input, 10);
	// A settled event alone must not overwrite an announced retry.
	reduceEvent(state, { type: "agent_settled" });
	assert.equal(state.state, "retrying");
	reduceEvent(state, { type: "auto_retry_end", attempt: 2 });
	reduceEvent(state, { type: "agent_settled" });
	assert.equal(state.state, "completed");
	assert.equal(state.settled, true);
});

test("JSONL decoder handles split UTF-8, malformed records, final record, and oversized lines", () => {
	const decoder = new JsonlDecoder();
	const encoded = Buffer.from('{"type":"agent_start","label":"é"}\nnot json\n{"type":"agent_end"}');
	const split = encoded.indexOf(Buffer.from("é")) + 1;
	const events = [...decoder.push(encoded.subarray(0, split)), ...decoder.push(encoded.subarray(split)), ...decoder.finish()];
	assert.deepEqual(events, [{ type: "agent_start", label: "é" }, { type: "agent_end" }]);
	const oversized = new JsonlDecoder();
	assert.deepEqual(oversized.push(Buffer.from(`{"x":"${"a".repeat(MAX_EVENT_LINE_BYTES)}"}\n`)), []);
});

test("UTF-8 output truncation preserves its byte bound", () => {
	const result = truncateUtf8("é".repeat(100), 101);
	assert.ok(Buffer.byteLength(result) <= 101);
	assert.ok(result.length > 0);
});

test("stderr retains a bounded useful tail", () => {
	const value = appendOutputBounded("", Buffer.from("x".repeat(256)), 80);
	assert.match(value, /^\[stderr truncated\]/);
	assert.ok(Buffer.byteLength(value) <= 80);
});

test("spawn errors preserve the useful diagnostic", async () => {
	const result = await runSpawnedJsonl({ command: "/definitely/not/a/pi-subagent", args: [], cwd: process.cwd(), timeoutMs: 5000, onEvent() {} });
	assert.equal(result.exitCode, 1);
	assert.match(result.spawnError || "", /ENOENT/);
});

test("owned child is terminated on timeout", async () => {
	const result = await runSpawnedJsonl({ command: process.execPath, args: ["-e", "setInterval(() => {}, 1000)"], cwd: process.cwd(), timeoutMs: 50, onEvent() {} });
	assert.equal(result.reason, "timed_out");
	assert.notEqual(result.exitCode, 0);
});

test("owned child is terminated on abort", async () => {
	const controller = new AbortController();
	setTimeout(() => controller.abort(), 30);
	const result = await runSpawnedJsonl({ command: process.execPath, args: ["-e", "setInterval(() => {}, 1000)"], cwd: process.cwd(), signal: controller.signal, timeoutMs: 5000, onEvent() {} });
	assert.equal(result.reason, "aborted");
	assert.notEqual(result.exitCode, 0);
});
