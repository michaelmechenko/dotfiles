import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { savePlanModeConfig } from "./config.ts";

const saved = { provider: "saved-provider", model: "saved-model", thinkingLevel: "medium" as const };

test("saving a plan execution default does not touch Pi global defaults", () => {
	const dir = mkdtempSync(join(tmpdir(), "plan-mode-default-"));
	try {
		const settings = join(dir, "settings.json");
		writeFileSync(settings, JSON.stringify({ defaultProvider: "global-provider", defaultModel: "global-model", defaultThinkingLevel: "low" }));
		savePlanModeConfig(saved, dir);
		assert.deepEqual(JSON.parse(readFileSync(settings, "utf8")), { defaultProvider: "global-provider", defaultModel: "global-model", defaultThinkingLevel: "low" });
		assert.deepEqual(JSON.parse(readFileSync(join(dir, "plan-mode.json"), "utf8")).executionModel, saved);
	} finally { rmSync(dir, { recursive: true, force: true }); }
});
