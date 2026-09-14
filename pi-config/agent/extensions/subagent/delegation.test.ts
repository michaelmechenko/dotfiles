import assert from "node:assert/strict";
import test from "node:test";
import { MAX_CHAIN_STEPS, normalizeDelegationRequest, replacePreviousLiteral, resolveChildTools } from "./delegation.ts";

test("delegation accepts exactly one nonempty mode", () => {
	for (const params of [
		{},
		{ tasks: [] },
		{ chain: [] },
		{ tasks: [], agent: "scout", task: "inspect" },
		{ agent: " ", task: "inspect" },
	]) assert.throws(() => normalizeDelegationRequest(params, "/repo"));
	const request = normalizeDelegationRequest({ agent: " scout ", task: " inspect ", cwd: "src" }, "/repo");
	assert.deepEqual(request, { mode: "single", items: [{ agent: "scout", task: "inspect", cwd: "/repo/src" }] });
	assert.throws(() => normalizeDelegationRequest({ chain: new Array(MAX_CHAIN_STEPS + 1).fill({ agent: "scout", task: "inspect" }) }, "/repo"));
});

test("child tools can narrow the parent's effective policy but never widen it", () => {
	const parent = ["read", "bash", "write", "subagent", "plan_update", "plan_step", "plan_complete"];
	assert.deepEqual(resolveChildTools({}, parent), ["read", "bash", "write"]);
	assert.deepEqual(resolveChildTools({ tools: ["read", "write"] }, ["read", "bash"]), ["read"]);
	assert.deepEqual(resolveChildTools({ tools: [] }, parent), []);
});

test("chain context replacement is literal", () => {
	assert.equal(replacePreviousLiteral("Review {previous}", "$& $` $' $$"), "Review $& $` $' $$");
});
