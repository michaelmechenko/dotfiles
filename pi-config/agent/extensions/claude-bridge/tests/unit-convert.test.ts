import { test } from "node:test";
import assert from "node:assert/strict";
import { convertPiMessages } from "../src/convert.ts";

test("session rebuild drops signed display thinking while preserving its tool round-trip", () => {
	const { anthropicMessages, dropped } = convertPiMessages([
		{ role: "user", content: "inspect the file" },
		{
			role: "assistant", provider: "claude-bridge", content: [
				{ type: "thinking", thinking: "display summary", thinkingSignature: "opaque-original-signature" },
				{ type: "toolCall", id: "tool:1", name: "read", arguments: { path: "x" } },
			],
		},
		{ role: "toolResult", toolCallId: "tool:1", content: "contents" },
	] as any);

	assert.equal(dropped.thinking, 1);
	assert.deepEqual(anthropicMessages, [
		{ role: "user", content: "inspect the file" },
		{ role: "assistant", content: [{ type: "tool_use", id: "tool_1", name: "Read", input: { path: "x" } }] },
		{ role: "user", content: [{ type: "tool_result", tool_use_id: "tool_1", content: "contents", is_error: undefined }] },
	]);
	assert.equal(JSON.stringify(anthropicMessages).includes('"thinking"'), false);
});

test("session rebuild retains a nonempty assistant slot when thinking was its only content", () => {
	const { anthropicMessages, dropped } = convertPiMessages([{
		role: "assistant", provider: "claude-bridge", content: [
			{ type: "thinking", thinking: "display summary", thinkingSignature: "opaque-original-signature" },
		],
	}] as any);
	assert.equal(dropped.thinking, 1);
	assert.deepEqual(anthropicMessages, [{
		role: "assistant", content: [{ type: "text", text: "[incompatible content omitted]" }],
	}]);
});
