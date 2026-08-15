import assert from "node:assert/strict";
import test from "node:test";
import { checkRestrictedToolCall, checkRestrictedUserBash, restrictedTools, restrictionGuidance } from "./restricted-mode.ts";

test("plan mode alone exposes plan_update", () => {
	const available = ["read", "bash", "write", "plan_update"];
	assert.deepEqual(restrictedTools("plan", available), ["read", "bash", "plan_update"]);
	assert.deepEqual(restrictedTools("read-only", available), ["read", "bash"]);
});

test("restricted mode fails closed and applies the bash allowlist", () => {
	assert.match(checkRestrictedToolCall("read-only", "write", {}) ?? "", /blocks/);
	assert.equal(checkRestrictedToolCall("plan", "plan_update", {}), undefined);
	assert.equal(checkRestrictedToolCall("plan", "bash", { command: "rg -n TODO ." }), undefined);
	assert.match(checkRestrictedToolCall("plan", "bash", { command: "echo hi > changed" }) ?? "", /read-only bash/);
	assert.match(checkRestrictedUserBash("read-only", "rm -rf /tmp/nope") ?? "", /read-only bash/);
	assert.equal(checkRestrictedUserBash("read-only", "git status --short"), undefined);
});

test("guidance is specific to the active restriction", () => {
	assert.match(restrictionGuidance("plan") ?? "", /plan_update/);
	assert.match(restrictionGuidance("read-only") ?? "", /Do not edit/);
	assert.equal(restrictionGuidance("none"), undefined);
});
