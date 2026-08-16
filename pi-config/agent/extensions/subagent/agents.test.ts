import assert from "node:assert/strict";
import test from "node:test";
import { parseToolList } from "./frontmatter.ts";

test("agent tools accepts YAML arrays and legacy comma-delimited strings", () => {
	assert.deepEqual(parseToolList(["read", " bash ", 3]), ["read", "bash"]);
	assert.deepEqual(parseToolList("read, bash"), ["read", "bash"]);
	assert.equal(parseToolList({ read: true }), undefined);
	assert.equal(parseToolList(["", 4]), undefined);
});
