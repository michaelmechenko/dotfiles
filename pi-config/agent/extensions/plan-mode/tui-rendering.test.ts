import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { realpathSync } from "node:fs";
import { dirname, resolve } from "node:path";
import test from "node:test";
import { pathToFileURL } from "node:url";
import type { Theme } from "@earendil-works/pi-coding-agent";
import { EXECUTION_SETTINGS_HELP, renderExecutionSettingsHeader, renderPlanProgress } from "./tui-rendering.ts";
import type { TodoItem } from "./utils.ts";

const piCli = realpathSync(execFileSync("which", ["pi"], { encoding: "utf8" }).trim());
const tuiPath = resolve(dirname(piCli), "..", "..", "node_modules", "@earendil-works", "pi-tui", "dist", "index.js");
const { truncateToWidth, visibleWidth } = await import(pathToFileURL(tuiPath).href);

const ansiTheme = {
	bold: (text: string) => `\x1b[1m${text}\x1b[22m`,
	fg: (_color: string, text: string) => `\x1b[38;2;120;130;140m${text}\x1b[39m`,
} as Pick<Theme, "bold" | "fg">;

function assertFits(lines: string[], width: number): void {
	for (const line of lines) assert.ok(visibleWidth(line) <= width, `${visibleWidth(line)} > ${width}: ${line}`);
}

test("execution settings header truncates the previously crashing help line", () => {
	assert.equal(visibleWidth(EXECUTION_SETTINGS_HELP), 84);
	const lines = renderExecutionSettingsHeader(ansiTheme, 75, truncateToWidth);
	assertFits(lines, 75);
	assert.equal(visibleWidth(lines[1]!), 75);
});

test("plan progress rerenders safely after a wide-to-narrow resize", () => {
	const steps: TodoItem[] = [{
		id: "long-step",
		step: 1,
		text: "Review every custom plan-mode rendering path and preserve ANSI styling while safely truncating terminal output",
		completed: false,
		skipped: false,
	}];
	const wide = renderPlanProgress(ansiTheme, steps, 0, 120, truncateToWidth);
	assert.ok(wide.some((line) => visibleWidth(line) > 75));
	assertFits(wide, 120);

	const narrow = renderPlanProgress(ansiTheme, steps, 0, 75, truncateToWidth);
	assertFits(narrow, 75);
	assert.notDeepEqual(narrow, wide);
});
