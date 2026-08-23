import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { inspectSavedExecutionModel, isModelSnapshot, loadPlanModeConfig, savePlanModeConfig } from "./config.ts";

const model = { provider: "test", model: "model", thinkingLevel: "high" as const };

test("a missing config leaves the execution default unset", () => {
	const dir = mkdtempSync(join(tmpdir(), "plan-mode-empty-"));
	try {
		assert.equal(loadPlanModeConfig(dir).executionModel, undefined);
		assert.deepEqual(inspectSavedExecutionModel(dir), { status: "missing" });
	} finally { rmSync(dir, { recursive: true, force: true }); }
});

test("config validates models and atomically changes only executionModel", () => {
	const dir = mkdtempSync(join(tmpdir(), "plan-mode-config-"));
	try {
		const path = join(dir, "plan-mode.json");
		writeFileSync(path, JSON.stringify({ retained: { keep: true }, executionModel: { provider: "old", model: "old", thinkingLevel: "off" } }));
		savePlanModeConfig(model, dir);
		const saved = JSON.parse(readFileSync(path, "utf8"));
		assert.deepEqual(saved.executionModel, model);
		assert.deepEqual(saved.retained, { keep: true });
		assert.deepEqual(loadPlanModeConfig(dir).executionModel, model);
		assert.deepEqual(inspectSavedExecutionModel(dir), { status: "valid", executionModel: model });
		assert.equal(isModelSnapshot({ ...model, thinkingLevel: "invalid" }), false);
	} finally { rmSync(dir, { recursive: true, force: true }); }
});

test("saved-model inspection distinguishes malformed configuration", () => {
	const dir = mkdtempSync(join(tmpdir(), "plan-mode-invalid-"));
	try {
		writeFileSync(join(dir, "plan-mode.json"), "{not json");
		assert.deepEqual(inspectSavedExecutionModel(dir), { status: "invalid" });
		writeFileSync(join(dir, "plan-mode.json"), JSON.stringify({ executionModel: { provider: "x" } }));
		assert.deepEqual(inspectSavedExecutionModel(dir), { status: "invalid" });
	} finally { rmSync(dir, { recursive: true, force: true }); }
});
