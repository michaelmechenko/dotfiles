import assert from "node:assert/strict";
import test from "node:test";
import { checkRestrictedToolCall, restrictedTools, restrictionGuidance } from "./restricted-mode.ts";

const baseline = ["read", "bash", "grep", "write", "edit", "apply_patch", "project_inspector", "plan_update"];
const available = [...baseline, "plan_step", "plan_complete"];

test("plan mode preserves the active baseline except direct file mutations", () => {
	assert.deepEqual(restrictedTools("plan", baseline, available), ["read", "bash", "grep", "project_inspector", "plan_update"]);
});

test("read-only mode preserves bash and project tools but removes plan tools", () => {
	assert.deepEqual(restrictedTools("read-only", baseline, available), ["read", "bash", "grep", "project_inspector"]);
	assert.match(checkRestrictedToolCall("read-only", "plan_update") ?? "", /blocks plan tools/);
	assert.equal(checkRestrictedToolCall("read-only", "bash"), undefined);
	assert.equal(checkRestrictedToolCall("read-only", "project_inspector"), undefined);
});

test("restricted modes block only direct file mutation tools", () => {
	for (const mode of ["plan", "read-only"] as const) {
		for (const tool of ["write", "edit", "apply_patch"]) assert.match(checkRestrictedToolCall(mode, tool) ?? "", /direct file mutation/);
	}
	assert.match(checkRestrictedToolCall("plan", "plan_step") ?? "", /execution-only/);
	assert.equal(checkRestrictedToolCall("plan", "plan_update"), undefined);
});

test("guidance explains direct mutation restrictions without restricting bash", () => {
	assert.match(restrictionGuidance("plan") ?? "", /including with bash/);
	assert.match(restrictionGuidance("read-only") ?? "", /Do not use write, edit, or apply_patch/);
});
