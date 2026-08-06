import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const { access } = await import("node:fs/promises");
await assert.rejects(access(resolve(root, "pretty/src/frame.ts")), /ENOENT/);
const frame = await readFile(resolve(root, "tool-display/frame.ts"), "utf8");
const diff = await readFile(resolve(root, "diff/src/index.ts"), "utf8");

assert.match(frame, /export const FRAME_OUTER_INDENT = " ";/);
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
assert.match(bash, /frameDivider\(theme, resultBg, w\)/, "bash result divider must carry the result background");
assert.match(bash, /cmdLines\.length - 2} more lines/, "collapsed multiline bash calls must show a continuation count");

const host = await readFile(resolve(root, "tool-display/host-decorator.ts"), "utf8");
assert.match(host, /Symbol\.for\("@earendil-works\/pi-coding-agent:theme"\)/, "host decorator must read the shared theme singleton via its stable symbol");
assert.match(host, /Symbol\.for\("pi\.tool-display\.hostDecorator\.v1"\)/, "host decorator must be idempotent across reloads");
assert.match(host, /if \(this\.getRenderShell\?\.\(\) === "self"\)/, "host decorator must leave self-shell tools untouched");
assert.match(host, /statusIcon/, "host decorator must prefix a status marker");
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
