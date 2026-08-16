import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const { access } = await import("node:fs/promises");
await assert.rejects(access(resolve(root, "pretty/src/frame.ts")), /ENOENT/);
const frame = await readFile(resolve(root, "tool-display/frame.ts"), "utf8");
const diff = await readFile(resolve(root, "diff/src/index.ts"), "utf8");
const hunkPreview = await readFile(resolve(root, "diff/src/review/hunk-preview.ts"), "utf8");
const toolDisplayState = await readFile(resolve(root, "tool-display/state.ts"), "utf8");
const toolDisplayIndex = await readFile(resolve(root, "tool-display/index.ts"), "utf8");
const readTool = await readFile(resolve(root, "pretty/src/tools/read.ts"), "utf8");

assert.match(frame, /export const FRAME_OUTER_INDENT = " ";/);
assert.match(frame, /export const EDGE_GLYPH = "▌";/, "accent edge glyph must stay canonical");
assert.match(frame, /const left = edgeColor \?\? PAD;/, "a styled edge token replaces exactly one left pad cell");
assert.doesNotMatch(frame, /\$\{edgeColor\}▌/, "frameRow must not append a second edge glyph");
assert.match(frame, /truncateToWidth\(content, actual - 2/);
assert.match(frame, /flatMap\(\(line\) => line\.split\("\\n"\)\)/);
assert.match(frame, /class FramedComponent implements Component/);
assert.match(frame, /export function frameCall/);
assert.match(frame, /export function frameComponentResult/);
assert.doesNotMatch(frame, /toolFrameContainer/);
assert.match(frame, /child\.render\(Math\.max\(1, actual - 2\)\)/);
assert.match(frame, /frameRow\(line, this\.background, actual\)/);
assert.match(frame, /\$\{background\}\$\{withBackground\}\\x1b\[0m/);
assert.match(frame, /export const toolCallFrame = frameCall/);
assert.match(frame, /return frameRows\(\["", call\], background, width\)/);
assert.match(frame, /export function toolResultFrame/);
assert.match(frame, /export function toolErrorFrame/);
assert.match(frame, /export function toolEmptyFrame/);
assert.match(frame, /─"\.repeat\(Math\.max\(1, width - 2\)\)/);
assert.match(frame, /framePadding\(result \? resultBg : callBg, width\)/);
assert.match(diff, /const interior = fit\(content, renderWidth - 2\)/);
assert.doesNotMatch(diff, /\$\{RST\}\$\{FG_DIM\}›\$\{RST\}/);
assert.doesNotMatch(diff, /if \(hasMore && w > 2\) row \+=/);
const bash = await readFile(resolve(root, "pretty/src/tools/bash.ts"), "utf8");
assert.doesNotMatch(bash, /const header = `\$\{TOOL_RESULT_INDENT\}/);
assert.match(bash, /import \{ truncateToWidth \} from "@earendil-works\/pi-tui";/, "bash must import truncateToWidth for multiline fitting");
assert.match(bash, /const resultBg = isErr \? theme\.getBgAnsi\?\.\("toolErrorBg"\) : theme\.getBgAnsi\?\.\("toolSuccessBg"\);/, "bash result rows must use an explicit semantic background");
assert.match(bash, /frameDivider\(theme, resultBg, w(?:, edge)?\)/, "bash result divider must carry the result background");
assert.match(bash, /cmdLines\.length - 2} more lines/, "collapsed multiline bash calls must show a continuation count");
assert.match(bash, /areToolCallsExpanded\(\)/, "multiline bash calls must use extension-owned call state");
assert.match(bash, /const resultsExpanded = !!ctx\.expanded;/, "bash results must use native expansion state");
assert.match(bash, /more lines \(ctrl\+o\)/, "bash result continuation must name the native result shortcut");
assert.match(readTool, /if \(!ctx\.expanded\)/, "read results must use native expansion state");
assert.match(readTool, /more lines — ctrl\+o/, "read continuation must name the native result shortcut");

assert.match(toolDisplayState, /callsExpanded: boolean/, "tool-display state must own call detail only");
assert.match(toolDisplayState, /CALL_TOGGLE_HINT = "ctrl\+shift\+o"/, "call hint must name Ctrl+Shift+O");
assert.doesNotMatch(toolDisplayState, /resultsExpanded|setToolsExpanded|refreshToolRows/, "tool-display state must not mutate native result expansion");
assert.match(toolDisplayIndex, /toggleToolCallsExpanded\(\)/, "Ctrl+Shift+O must toggle call state");
assert.doesNotMatch(toolDisplayIndex, /setToolsExpanded|refreshToolRows/, "Ctrl+Shift+O must not refresh native result rows");

assert.match(diff, /function resultPreviewLimit\(compactLimit: number, expanded: boolean\)/, "diff must select a limit from native result state");
assert.match(diff, /const contentKey = diffContentKey\(diff\);/, "diff cache keys must include content");
assert.match(diff, /:\$\{contentKey\}:\$\{maxLines\}:/, "diff cache keys must include selected preview limit");
assert.doesNotMatch(diff, /───── Edit \$\{i \+ 1\} ─────/, "multi-edit data must carry semantic labels only");
assert.match(diff, /content: `Edit \$\{i \+ 1\}`/, "both multi-edit branches must emit semantic labels");
assert.doesNotMatch(hunkPreview, /Math\.min\(renderWidth, 72\)/, "multi-edit dividers must not cap at 72 columns");
assert.match(hunkPreview, /const totalWidth = renderWidth;/, "unified dividers must span the full result width");
assert.match(hunkPreview, /row\.left\?\.type === "sep" \|\| row\.right\?\.type === "sep"/, "split rendering must own one full-width separator");

const host = await readFile(resolve(root, "tool-display/host-decorator.ts"), "utf8");
assert.match(host, /Symbol\.for\("@earendil-works\/pi-coding-agent:theme"\)/, "host decorator must read the shared theme singleton via its stable symbol");
assert.match(host, /Symbol\.for\("pi\.tool-display\.hostDecorator\.v1"\)/, "host decorator must be idempotent across reloads");
assert.match(host, /if \(this\.getRenderShell\?\.\(\) === "self"\)/, "host decorator must leave self-shell tools untouched");
assert.match(host, /statusIcon/, "host decorator must prefix a status marker");
assert.match(host, /return cardEdgeColor\(cardState\(instance\), theme as ToolFrameTheme\);/, "host decorator must use the complete styled edge token");
assert.doesNotMatch(host, /cardEdgeColor\(cardState\(instance\), theme as ToolFrameTheme\)\}▌/, "host decorator must not append a second edge glyph");
assert.match(host, /BORDERED_MUTATION_TOOLS/, "host decorator must know the mutation tool set so it can defer their body divider to the diff renderer");
assert.match(host, /if \(!BORDERED_MUTATION_TOOLS\.has\(toolName\)\)/, "host decorator must skip its own divider for diff-rendered mutation tools to avoid stacked dashed lines");
assert.match(host, /frameRow|applyBg/, "host decorator must frame rows with the semantic background");
assert.match(host, /return origRender\.call\(this, width\);/, "host decorator must fall back to the original render on any failure");
const index = await readFile(resolve(root, "tool-display/index.ts"), "utf8");
assert.match(index, /import \{ installHostDecorator \} from "\.\/host-decorator\.js";/, "tool-display must install the host decorator");
assert.match(index, /installHostDecorator\(\);/, "tool-display must call installHostDecorator");

const ansi = "\x1b[38;2;1;2;3mhello\x1b[0m";
const visible = ansi.replace(/\x1b\[[0-9;]*m/g, "").length;
assert.equal(visible, 5, "ANSI-aware contract fixture should count visible cells");
assert.match(frame, /Math\.max\(2, width\)/, "frames must enforce a two-cell minimum");

const stripAnsi = (value) => value.replace(/\x1b\[[0-9;]*m/g, "");
const fitRow = (content, width) => {
	const inner = stripAnsi(content).slice(0, Math.max(0, width - 2));
	return ` ${inner.padEnd(Math.max(0, width - 2), " ")} `;
};
const assertRows = (rows, width) => {
	assert.equal(rows.length, 4);
	for (const row of rows) assert.equal(stripAnsi(row).length, width);
	assert.equal(stripAnsi(rows[0]), " ".repeat(width));
	assert.equal(stripAnsi(rows.at(-1)), " ".repeat(width));
};
const fakeRichRows = [" ", " ", "rich content", " "].map((line) => fitRow(line, 12));
assertRows(fakeRichRows, 12);
const multilineRows = "first\nsecond".split("\n").map((line) => fitRow(line, 12));
assert.deepEqual(multilineRows.map(stripAnsi), [" first      ", " second     "]);
assert.equal(stripAnsi(fitRow("\x1b[31mwide content\x1b[0m", 5)), " wid ");
assert.match(frame, /child\.invalidate\(\)/, "rich children must receive invalidation");

console.log("tool frame contract: ok");
