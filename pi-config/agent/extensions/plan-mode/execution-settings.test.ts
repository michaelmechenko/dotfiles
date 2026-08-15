import assert from "node:assert/strict";
import test from "node:test";
import { createExecutionSettings, resolveExecutionSettings, type ModelCandidate } from "./execution-settings.ts";

const current = { provider: "current", model: "current-model", thinkingLevel: "low" as const };
const saved = { provider: "saved", model: "saved-model", thinkingLevel: "high" as const };
const candidates: ModelCandidate[] = [
	{ provider: "current", model: "current-model", thinkingLevels: ["low", "medium"] },
	{ provider: "saved", model: "saved-model", thinkingLevels: ["high"] },
	{ provider: "choice", model: "choice-model", thinkingLevels: ["minimal", "medium"] },
];

test("execution settings default to the requested destination and model policy", () => {
	assert.deepEqual(createExecutionSettings(current, "tmux-pane", "saved"), { destination: "tmux-pane", modelPolicy: "saved", provider: "current", model: "current-model", thinkingLevel: "low", saveDefault: false });
});

test("execution settings resolve each model policy without persistence side effects", () => {
	assert.deepEqual(resolveExecutionSettings(createExecutionSettings(current), current, saved, candidates), { ok: true, value: { destination: "current", model: current, saveDefault: false } });
	assert.deepEqual(resolveExecutionSettings({ ...createExecutionSettings(current), modelPolicy: "saved" }, current, saved, candidates), { ok: true, value: { destination: "current", model: saved, saveDefault: false } });
	assert.deepEqual(resolveExecutionSettings({ destination: "tmux-pane", modelPolicy: "choose", provider: "choice", model: "choice-model", thinkingLevel: "medium", saveDefault: true }, current, saved, candidates), { ok: true, value: { destination: "tmux-pane", model: { provider: "choice", model: "choice-model", thinkingLevel: "medium" }, saveDefault: true } });
});

test("clipboard and cancellation-equivalent invalid selections preserve model intent", () => {
	assert.deepEqual(resolveExecutionSettings({ destination: "clipboard", modelPolicy: "choose", provider: "missing", model: "missing", thinkingLevel: "max", saveDefault: true }, current, saved, candidates), { ok: true, value: { destination: "clipboard", saveDefault: false } });
	const invalid = resolveExecutionSettings({ destination: "current", modelPolicy: "choose", provider: "choice", model: "choice-model", thinkingLevel: "high", saveDefault: true }, current, saved, candidates);
	assert.equal(invalid.ok, false);
	if (!invalid.ok) assert.match(invalid.error, /Select an available/);
});
