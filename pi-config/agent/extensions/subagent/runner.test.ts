import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { appendOutputBounded, createRunnerState, JsonlDecoder, MAX_ERROR_BYTES, MAX_METADATA_BYTES, MAX_RETAINED_MESSAGE_BYTES, reduceEvent, runSpawnedJsonl, truncateUtf8 } from "./runner.ts";

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

test("JSONL decoder handles split UTF-8 and distinguishes malformed from oversized records", () => {
	const decoder = new JsonlDecoder();
	const encoded = Buffer.from('{"type":"agent_start","label":"é"}\nnot json\n{"type":"agent_end"}');
	const split = encoded.indexOf(Buffer.from("é")) + 1;
	const events = [...decoder.push(encoded.subarray(0, split)), ...decoder.push(encoded.subarray(split)), ...decoder.finish()];
	assert.deepEqual(events, [{ type: "agent_start", label: "é" }, { type: "agent_end" }]);
	assert.deepEqual(decoder.issues, [{ record: 2, bytes: 8, kind: "malformed" }]);

	const oversized = new JsonlDecoder(32, 64);
	assert.deepEqual(oversized.push(Buffer.alloc(1024, 0x61)), []);
	assert.ok(oversized.bufferedBytes <= 32);
	assert.deepEqual(oversized.push(Buffer.from('\n{"type":"agent_settled"}\n')), [{ type: "agent_settled" }]);
	assert.equal(oversized.oversizedLines, 1);
	assert.deepEqual(oversized.issues, [{ record: 1, bytes: 1024, kind: "oversized" }]);
});

test("JSONL decoder accepts and projects a valid aggregate agent_end above the soft cap", () => {
	const payload = JSON.stringify({
		type: "agent_end",
		willRetry: false,
		messages: new Array(20).fill(null).map((_, index) => ({ role: "toolResult", toolCallId: String(index), content: [{ type: "text", text: "x".repeat(60_000) }] })),
	});
	assert.ok(Buffer.byteLength(payload) > 1024 * 1024);
	const decoder = new JsonlDecoder();
	const events = [...decoder.push(Buffer.from(`${payload}\n`)), ...decoder.finish()];
	assert.deepEqual(events, [{ type: "agent_end", willRetry: false }]);
	assert.equal(decoder.rejectedLines, 0);
});

test("JSONL decoder falls back to bounded memory when its spill directory is unavailable", () => {
	const dir = mkdtempSync(path.join(os.tmpdir(), "pi-subagent-spill-test-"));
	const notDirectory = path.join(dir, "not-a-directory");
	writeFileSync(notDirectory, "x");
	const previous = process.env.TMPDIR;
	process.env.TMPDIR = notDirectory;
	try {
		const payload = JSON.stringify({ type: "agent_end", willRetry: false, messages: ["x".repeat(256)] });
		const decoder = new JsonlDecoder(32, 1024);
		assert.deepEqual(decoder.push(Buffer.from(`${payload}\n`)), [{ type: "agent_end", willRetry: false }]);
		assert.equal(decoder.rejectedLines, 0);
		decoder.finish();
	} finally {
		if (previous === undefined) delete process.env.TMPDIR;
		else process.env.TMPDIR = previous;
		rmSync(dir, { recursive: true, force: true });
	}
});

test("runner details retain bounded message bytes while output capture receives the full answer", () => {
	let captured = "";
	const state = createRunnerState(undefined, (output) => {
		captured = output;
		return { preview: truncateUtf8(output, 1024), truncated: true, artifact: { path: "/private/result.md", bytes: Buffer.byteLength(output) } };
	});
	const text = "é".repeat(100_000);
	reduceEvent(state, { type: "message_end", message: { role: "assistant", content: [{ type: "text", text }], usage: {} } });
	assert.equal(captured, text);
	assert.ok(state.messageBytes <= MAX_RETAINED_MESSAGE_BYTES);
	assert.ok(Buffer.byteLength(state.finalOutput, "utf8") <= 1024);
	assert.equal(state.outputArtifact?.path, "/private/result.md");
});

test("runner bounds adversarial metadata and ignores invalid usage numbers", () => {
	const state = createRunnerState();
	const huge = "z".repeat(100_000);
	reduceEvent(state, { type: "tool_execution_start", toolName: huge });
	reduceEvent(state, { type: "message_end", message: { role: "assistant", model: huge, stopReason: huge, errorMessage: huge, content: new Array(20_000).fill(null).map((_, index) => ({ type: "toolCall", id: String(index), name: huge })), usage: { input: Infinity, output: -1, cacheRead: "9", totalTokens: NaN, cost: { total: Infinity } } } });
	assert.ok(Buffer.byteLength(state.activeTool || "") <= MAX_METADATA_BYTES);
	assert.ok(Buffer.byteLength(state.model || "") <= MAX_METADATA_BYTES);
	assert.ok(Buffer.byteLength(state.stopReason || "") <= MAX_METADATA_BYTES);
	assert.ok(Buffer.byteLength(state.errorMessage || "") <= MAX_ERROR_BYTES);
	assert.ok(state.messageBytes <= MAX_RETAINED_MESSAGE_BYTES);
	assert.deepEqual(state.usage, { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cost: 0, contextTokens: 0, turns: 1 });
});

test("nested tool usage is included without counting an extra assistant turn", () => {
	const state = createRunnerState();
	reduceEvent(state, { type: "message_end", message: { role: "toolResult", usage: { input: 12, output: 8, cost: { total: 0.5 } } } });
	assert.equal(state.usage.input, 12);
	assert.equal(state.usage.output, 8);
	assert.equal(state.usage.cost, 0.5);
	assert.equal(state.usage.turns, 0);
});

test("UTF-8 output truncation preserves its byte bound", () => {
	const result = truncateUtf8("é".repeat(100), 101);
	assert.ok(Buffer.byteLength(result) <= 101);
	assert.ok(result.length > 0);
	assert.equal(truncateUtf8("😀😀", 3), "");
	assert.equal(truncateUtf8("😀😀", 4), "😀");
	assert.ok(truncateUtf8("界".repeat(100_000), 50 * 1024).isWellFormed());
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
	assert.match(malformed.protocolError || "", /1 malformed, 0 oversized, and 0 transport-failed.*record 1: malformed, 8 bytes/);
	const oversized = await runSpawnedJsonl({ command: process.execPath, args: ["-e", "process.stdout.write('x'.repeat(17 * 1024 * 1024) + '\\n')"], cwd: process.cwd(), onEvent() {} });
	assert.match(oversized.protocolError || "", /0 malformed, 1 oversized, and 0 transport-failed.*record 1: oversized/);
});

test("spawn errors preserve the useful diagnostic", async () => {
	const result = await runSpawnedJsonl({ command: "/definitely/not/a/pi-subagent", args: [], cwd: process.cwd(), timeoutMs: 5000, onEvent() {} });
	assert.equal(result.exitCode, 1);
	assert.match(result.spawnError || "", /ENOENT/);
});

test("runner forwards an explicit child-policy environment", async () => {
	let inherited: unknown;
	const result = await runSpawnedJsonl({ command: process.execPath, args: ["-e", "console.log(JSON.stringify({type:'policy',mode:process.env.PI_SUBAGENT_ACCESS_MODE,tools:process.env.PI_SUBAGENT_ALLOWED_TOOLS}));console.log(JSON.stringify({type:'agent_end'}))"], cwd: process.cwd(), env: { ...process.env, PI_SUBAGENT_ACCESS_MODE: "read-only", PI_SUBAGENT_ALLOWED_TOOLS: '["read"]' }, onEvent(event) { if ((event as { type?: string }).type === "policy") inherited = event; } });
	assert.equal(result.protocolError, undefined);
	assert.deepEqual(inherited, { type: "policy", mode: "read-only", tools: '["read"]' });
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
