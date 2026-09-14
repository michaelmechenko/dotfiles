import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { realpathSync } from "node:fs";
import { dirname, resolve } from "node:path";
import test from "node:test";
import { pathToFileURL } from "node:url";

const piCli = realpathSync(execFileSync("which", ["pi"], { encoding: "utf8" }).trim());
const codingAgentRoot = resolve(dirname(piCli), "..", "..");
const codingAgentPath = resolve(codingAgentRoot, "dist", "index.js");
const tuiPath = resolve(codingAgentRoot, "node_modules", "@earendil-works", "pi-tui", "dist", "index.js");
const jitiPath = resolve(codingAgentRoot, "node_modules", "jiti", "lib", "jiti.mjs");
const { createJiti } = await import(pathToFileURL(jitiPath).href);
const { stripTerminalSequences, visibleWidth } = await import(pathToFileURL(tuiPath).href);
const jiti = createJiti(import.meta.url, {
	fsCache: false,
	moduleCache: false,
	alias: {
		"@earendil-works/pi-coding-agent": codingAgentPath,
		"@earendil-works/pi-tui": tuiPath,
	},
});
const { parseDiff } = (await jiti.import(resolve(import.meta.dirname, "../core/diff.ts"))) as {
	parseDiff: (oldContent: string, newContent: string) => unknown;
};
const { renderSplit } = (await jiti.import(resolve(import.meta.dirname, "hunk-preview.ts"))) as {
	renderSplit: (
		diff: unknown,
		language: string | undefined,
		maxLines: number,
		colors: { fgAdd: string; fgDel: string; fgCtx: string },
		width: number,
		options?: { compactGutter?: boolean },
	) => Promise<string>;
};
const displayState = (await jiti.import(resolve(import.meta.dirname, "../../../tool-display/state.ts"))) as {
	resetToolDisplayState: () => void;
	toggleToolOutputWrap: () => boolean;
};

const colors = { fgAdd: "", fgDel: "", fgCtx: "" };
const plainRows = (rendered: string) => rendered.split("\n").map((line) => stripTerminalSequences(line));
const assertWidth = (rendered: string, width: number) => {
	for (const [index, line] of rendered.split("\n").entries()) {
		assert.equal(visibleWidth(line), width, `row ${index} must occupy exactly ${width} cells`);
	}
};

test("split rendering preserves fixed columns for asymmetric rows", async (t) => {
	displayState.resetToolDisplayState();
	await t.test("right continuation stays in the right half", async () => {
		const rendered = await renderSplit(
			parseDiff("x\nc", `${"y".repeat(65)}Z\nc`),
			undefined,
			100,
			colors,
			140,
			{ compactGutter: true },
		);
		const rows = plainRows(rendered);
		assert.equal(rows[1]?.indexOf("Z"), 75);
		assertWidth(rendered, 140);
	});

	await t.test("unmatched additions and deletions retain their side", async () => {
		for (const compactGutter of [true, false]) {
			const gutterWidth = compactGutter ? 5 : 6;
			for (const [oldContent, newContent, needle, expectedColumn] of [
				["old\nc", "new\nEXTRA\nc", "EXTRA", 70 + gutterWidth],
				["old\nEXTRA\nc", "new\nc", "EXTRA", gutterWidth],
			] as const) {
				const rendered = await renderSplit(parseDiff(oldContent, newContent), undefined, 100, colors, 140, {
					compactGutter,
				});
				const row = plainRows(rendered).find((line) => line.includes(needle));
				assert.ok(row);
				assert.equal(row.indexOf(needle), expectedColumn);
				assertWidth(rendered, 140);
			}
		}
	});
});

test("rendered rows obey terminal-cell widths", async () => {
	displayState.resetToolDisplayState();
	for (const [oldContent, newContent, grapheme, expectedCount] of [
		[`${"界".repeat(10)}old\nc`, `${"界".repeat(10)}new\nc`, "界", 20],
		[`${"e\u0301".repeat(10)}old\nc`, `${"e\u0301".repeat(10)}new\nc`, "e\u0301", 20],
	] as const) {
		const rendered = await renderSplit(parseDiff(oldContent, newContent), undefined, 100, colors, 140, {
			compactGutter: true,
		});
		assertWidth(rendered, 140);
		assert.equal(plainRows(rendered).join("").split(grapheme).length - 1, expectedCount);
	}

	for (const width of [1, 2, 5, 6, 22, 24, 40, 79, 80, 81, 120, 141, 180, 240]) {
		for (const compactGutter of [true, false]) {
			const rendered = await renderSplit(parseDiff("old value\nc", "new value\nc"), undefined, 100, colors, width, {
				compactGutter,
			});
			assertWidth(rendered, width);
		}
	}

	for (const width of [1, 5, 22, 80, 141]) {
		const rendered = await renderSplit(parseDiff("old value\nc", "new value\nc"), undefined, 1, colors, width, {
			compactGutter: true,
		});
		if (width > 1) assert.match(plainRows(rendered).at(-1) ?? "", /…|›/);
		assertWidth(rendered, width);
	}
});

test("split selection changes only at the configured width boundary", async () => {
	displayState.resetToolDisplayState();
	for (const [width, expectedSameRow] of [[79, false], [80, true], [81, true]] as const) {
		const rendered = await renderSplit(parseDiff("old\nc", "new\nc"), undefined, 100, colors, width, {
			compactGutter: true,
		});
		const changeRows = plainRows(rendered).filter((line) => line.includes("old") || line.includes("new"));
		assert.equal(changeRows.some((line) => line.includes("old") && line.includes("new")), expectedSameRow);
		assertWidth(rendered, width);
	}
});

test("clip mode emits one fitted physical row per logical row", async () => {
	displayState.resetToolDisplayState();
	displayState.toggleToolOutputWrap();
	try {
		const rendered = await renderSplit(
			parseDiff("x\nc", `${"y".repeat(90)}Z\nc`),
			undefined,
			100,
			colors,
			140,
			{ compactGutter: true },
		);
		assert.equal(rendered.split("\n").length, 2);
		assert.match(plainRows(rendered)[0] ?? "", /…/);
		assertWidth(rendered, 140);
	} finally {
		displayState.resetToolDisplayState();
	}
});
