import assert from "node:assert/strict";
import test from "node:test";
import { resolveToolSelection } from "./tool-policy.ts";

test("disabled deltas retain newly installed tools", () => {
	assert.deepEqual(resolveToolSelection(["read", "write", "new_tool"], ["read", "write"], ["write"], false), ["read", "new_tool"]);
});

test("plan and read-only restricted baselines remain authoritative", () => {
	assert.deepEqual(resolveToolSelection(["read", "write", "new_tool"], ["read", "plan_update"], [], true), ["read", "plan_update"]);
	assert.deepEqual(resolveToolSelection(["read", "write", "new_tool", "plan_step", "plan_complete"], ["read", "write", "plan_step", "plan_complete"], [], true), ["read", "write", "plan_step", "plan_complete"]);
	assert.deepEqual(resolveToolSelection(["read", "write"], ["read"], ["read"], true), []);
	assert.deepEqual(resolveToolSelection(["read", "write", "new_tool"], ["read"], [], false), ["read", "write", "new_tool"]);
});

test("internal planning availability respects an explicit user-disabled delta", () => {
	assert.deepEqual(resolveToolSelection(["read", "write", "plan_update"], ["read", "plan_update"], [], true), ["read", "plan_update"]);
	assert.deepEqual(resolveToolSelection(["read", "write", "plan_update"], ["read", "plan_update"], ["plan_update"], true), ["read"]);
	assert.deepEqual(resolveToolSelection(["read", "write", "plan_update"], ["read"], ["plan_update"], false), ["read", "write"]);
});
