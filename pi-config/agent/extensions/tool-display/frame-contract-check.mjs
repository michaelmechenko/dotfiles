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
assert.match(frame, /export function toolCallFrame/);
assert.match(frame, /framePadding\(background, width\), frameRow\(call, background, width\)/);
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

console.log("tool frame contract: ok");
