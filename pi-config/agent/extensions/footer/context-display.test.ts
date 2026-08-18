import assert from "node:assert/strict";
import test from "node:test";
import { compactionLabel, contextTone } from "./context-display.ts";

test("context urgency uses existing semantic thresholds", () => {
	assert.equal(contextTone(69.9), "dim");
	assert.equal(contextTone(70), "warning");
	assert.equal(contextTone(89.9), "warning");
	assert.equal(contextTone(90), "error");
});

test("compaction label reflects enabled and active state", () => {
	assert.equal(compactionLabel(true, false), " (auto)");
	assert.equal(compactionLabel(false, false), " (manual)");
	assert.equal(compactionLabel(true, true), " (compacting)");
});
