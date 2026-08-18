import assert from "node:assert/strict";
import test from "node:test";
import { normalizeEditOperations } from "./edit-operations.ts";

test("normalizes array, legacy, and snake-case edit shapes", () => {
	assert.deepEqual(normalizeEditOperations({ edits: [{ oldText: "a", newText: "b" }] }), [{ oldText: "a", newText: "b" }]);
	assert.deepEqual(normalizeEditOperations({ oldText: "a", newText: "b" }), [{ oldText: "a", newText: "b" }]);
	assert.deepEqual(normalizeEditOperations({ old_text: "a", new_text: "b" }), [{ oldText: "a", newText: "b" }]);
	assert.deepEqual(normalizeEditOperations({ oldText: "a", newText: "a" }), []);
});
