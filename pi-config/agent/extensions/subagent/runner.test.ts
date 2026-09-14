import assert from "node:assert/strict";
import test from "node:test";
import { appendOutputBounded, createRunnerState, JsonlDecoder, reduceEvent, runSpawnedJsonl, truncateUtf8 } from "./runner.ts";

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
	const oversized = new JsonlDecoder(32);
	assert.deepEqual(oversized.push(Buffer.alloc(1024 * 1024, 0x61)), []);
	assert.ok(oversized.bufferedBytes <= 32);
	assert.equal(oversized.rejectedLines, 1);
	assert.deepEqual(oversized.push(Buffer.from('\n{"type":"agent_settled"}\n')), [{ type: "agent_settled" }]);
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

test("successful child output requires one final documented agent_end event", async () => {
	const valid = await runSpawnedJsonl({ command: process.execPath, args: ["-e", "console.log(JSON.stringify({type:'agent_end',willRetry:false})); console.log(JSON.stringify({type:'agent_settled'}))"], cwd: process.cwd(), onEvent() {} });
	assert.equal(valid.protocolError, undefined);
	const documentedOnly = await runSpawnedJsonl({ command: process.execPath, args: ["-e", "console.log(JSON.stringify({type:'agent_end'}))"], cwd: process.cwd(), onEvent() {} });
	assert.equal(documentedOnly.protocolError, undefined);
	const missing = await runSpawnedJsonl({ command: process.execPath, args: ["-e", "console.log(JSON.stringify({type:'agent_start'}))"], cwd: process.cwd(), onEvent() {} });
	assert.match(missing.protocolError || "", /expected exactly one/);
	const malformed = await runSpawnedJsonl({ command: process.execPath, args: ["-e", "console.log('not json')"], cwd: process.cwd(), onEvent() {} });
	assert.match(malformed.protocolError || "", /malformed or oversized/);
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

test("timeout terminates the owned process group", { skip: process.platform === "win32" }, async () => {
	const script = `const {spawn}=require('node:child_process'); const child=spawn(process.execPath,['-e',\"process.on('SIGTERM',()=>{}); setInterval(()=>{},1000)\"]); console.error('grandchild:'+child.pid); setInterval(()=>{},1000);`;
	const result = await runSpawnedJsonl({ command: process.execPath, args: ["-e", script], cwd: process.cwd(), timeoutMs: 50, killGraceMs: 50, onEvent() {} });
	const pid = Number(/grandchild:(\d+)/.exec(result.stderr)?.[1]);
	assert.ok(pid > 0);
	let alive = true;
	for (let attempt = 0; attempt < 20 && alive; attempt++) {
		await new Promise((resolve) => setTimeout(resolve, 25));
		try { process.kill(pid, 0); } catch { alive = false; }
	}
	assert.equal(alive, false);
});
