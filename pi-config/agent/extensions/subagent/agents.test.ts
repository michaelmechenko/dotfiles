import assert from "node:assert/strict";
import test from "node:test";
import { parseToolList } from "./frontmatter.ts";

test("agent tools preserve absent, empty, and populated policies", () => {
	assert.deepEqual(parseToolList(undefined), { status: "absent" });
	assert.deepEqual(parseToolList([]), { status: "valid", tools: [] });
	assert.deepEqual(parseToolList("read, bash"), { status: "valid", tools: ["read", "bash"] });
});

test("malformed tool policies are rejected instead of broadened", () => {
	assert.equal(parseToolList({ read: true }).status, "invalid");
	assert.equal(parseToolList(["read", 3]).status, "invalid");
});
