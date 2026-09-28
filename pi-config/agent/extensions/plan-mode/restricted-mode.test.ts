import assert from "node:assert/strict";
import test from "node:test";
import { checkRestrictedToolCall, isLensMutation, restrictedTools, restrictionGuidance } from "./restricted-mode.ts";

const baseline = ["read", "bash", "grep", "write", "edit", "apply_patch", "project_inspector", "plan_update"];
const available = [...baseline, "plan_step", "plan_complete"];

test("plan mode preserves the active baseline except direct file mutations", () => {
	assert.deepEqual(restrictedTools("plan", baseline, available), ["read", "bash", "grep", "project_inspector", "plan_update"]);
	assert.deepEqual(restrictedTools("plan", baseline.filter((name) => name !== "plan_update"), available), ["read", "bash", "grep", "project_inspector"]);
});

test("read-only mode preserves internal planning but removes tracked execution tools", () => {
	assert.deepEqual(restrictedTools("read-only", baseline, available), ["read", "bash", "grep", "project_inspector", "plan_update"]);
	assert.equal(checkRestrictedToolCall("read-only", "plan_update"), undefined);
	assert.match(checkRestrictedToolCall("read-only", "plan_step") ?? "", /tracked execution tools/);
	assert.equal(checkRestrictedToolCall("read-only", "bash"), undefined);
	assert.equal(checkRestrictedToolCall("read-only", "project_inspector"), undefined);
});

test("restricted modes block direct and parameter-dependent pi-lens mutations", () => {
	for (const mode of ["plan", "read-only"] as const) {
		for (const tool of ["write", "edit", "apply_patch"]) assert.match(checkRestrictedToolCall(mode, tool) ?? "", /direct file mutation/);
		assert.match(checkRestrictedToolCall(mode, "ast_grep_replace", { apply: true }) ?? "", /mutating pi-lens/);
		assert.match(checkRestrictedToolCall(mode, "lsp_navigation", { operation: "rename", apply: true }) ?? "", /mutating pi-lens/);
		assert.match(checkRestrictedToolCall(mode, "lsp_navigation", { operation: "rename_file", apply: true }) ?? "", /mutating pi-lens/);
		assert.match(checkRestrictedToolCall(mode, "lsp_navigation", { operation: "executeCommand", apply: true }) ?? "", /mutating pi-lens/);
		assert.match(checkRestrictedToolCall(mode, "lens_diagnostic_mark", { disposition: "suppress" }) ?? "", /mutating pi-lens/);
	}
	assert.equal(isLensMutation("ast_grep_replace", { apply: false }), false);
	assert.equal(checkRestrictedToolCall("plan", "ast_grep_replace", { apply: false }), undefined);
	assert.equal(checkRestrictedToolCall("plan", "lsp_navigation", { operation: "rename", apply: false }), undefined);
	assert.equal(checkRestrictedToolCall("plan", "lsp_navigation", { operation: "references", apply: true }), undefined);
	assert.equal(checkRestrictedToolCall("plan", "lens_diagnostic_mark", { disposition: "defer" }), undefined);
	assert.equal(checkRestrictedToolCall("none", "ast_grep_replace", { apply: true }), undefined);
	assert.match(checkRestrictedToolCall("plan", "plan_step") ?? "", /execution-only/);
	assert.equal(checkRestrictedToolCall("plan", "plan_update"), undefined);
});

test("guidance explains direct mutation restrictions without restricting bash", () => {
	assert.match(restrictionGuidance("plan") ?? "", /including with bash/);
	assert.match(restrictionGuidance("read-only") ?? "", /Do not use write, edit, or apply_patch/);
	assert.match(restrictionGuidance("read-only") ?? "", /internal agent plan/);
});
