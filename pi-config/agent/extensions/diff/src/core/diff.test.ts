import assert from "node:assert/strict";
import test from "node:test";
import { pairChangeBlock } from "./diff.ts";

test("pairs balanced replacement rows by ordinal position", () => {
	assert.deepEqual(pairChangeBlock(["old 1", "old 2"], ["new 1", "new 2"]), [
		{ deletion: "old 1", addition: "new 1" },
		{ deletion: "old 2", addition: "new 2" },
	]);
});

test("retains unmatched trailing rows in imbalanced replacement blocks", () => {
	assert.deepEqual(pairChangeBlock(["old 1", "old 2", "old 3"], ["new 1"]), [
		{ deletion: "old 1", addition: "new 1" },
		{ deletion: "old 2", addition: undefined },
		{ deletion: "old 3", addition: undefined },
	]);
	assert.deepEqual(pairChangeBlock(["old 1"], ["new 1", "new 2", "new 3"]), [
		{ deletion: "old 1", addition: "new 1" },
		{ deletion: undefined, addition: "new 2" },
		{ deletion: undefined, addition: "new 3" },
	]);
});

test("preserves one-sided change blocks", () => {
	assert.deepEqual(pairChangeBlock([], ["new 1", "new 2"]), [
		{ deletion: undefined, addition: "new 1" },
		{ deletion: undefined, addition: "new 2" },
	]);
	assert.deepEqual(pairChangeBlock(["old 1", "old 2"], []), [
		{ deletion: "old 1", addition: undefined },
		{ deletion: "old 2", addition: undefined },
	]);
});
