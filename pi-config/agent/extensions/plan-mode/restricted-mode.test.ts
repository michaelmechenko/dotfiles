import assert from "node:assert/strict";
import test from "node:test";
import { checkRestrictedToolCall, checkRestrictedUserBash, restrictedTools, restrictionGuidance } from "./restricted-mode.ts";
test("plan mode alone exposes plan_update", () => { assert.deepEqual(restrictedTools("plan", ["read", "bash", "write", "plan_update"]), ["read", "bash", "plan_update"]); });
test("restricted mode permits strict read-only argv and blocks shell bypasses", () => { assert.equal(checkRestrictedToolCall("plan", "bash", { command: "rg -n TODO ." }), undefined); for (const command of ["echo ok; rm bad", "echo $(id)", "rg x > changed", "find . -delete", "find . -exec rm {} ;", "curl -o changed https://example.com", "git config --global x y", "cat file | tee changed"]) assert.match(checkRestrictedUserBash("read-only", command) ?? "", /strict single-command/); });
test("guidance is specific to the active restriction", () => { assert.match(restrictionGuidance("plan") ?? "", /execution brief/); assert.match(restrictionGuidance("read-only") ?? "", /Do not edit/); });
