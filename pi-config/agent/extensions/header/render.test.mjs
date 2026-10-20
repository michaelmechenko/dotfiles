import assert from 'node:assert/strict';
import test from 'node:test';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { jiti, root } from '../test-runtime.mjs';
const { formatSummary, resourceDisplayName } = await jiti.import(resolve(import.meta.dirname, 'index.ts'));
const { visibleWidth, CURSOR_MARKER, renderFakeCursor } = await jiti.import('@earendil-works/pi-tui');
const { TuiBase } = await import(pathToFileURL(resolve(root, 'node_modules/@earendil-works/pi-tui/dist/tui.js')).href);
test('native cursor removes the focused drawn block for empty, typed, and dialog cells', () => {
  const ui = new TuiBase({}, true);
  for (const cell of [' ', 'x', 'choice']) {
    assert.deepEqual(ui.resolveFakeCursors([CURSOR_MARKER + renderFakeCursor(cell)]), [CURSOR_MARKER + cell]);
  }
});
const names = ['code-review', 'interface-kit', 'pi-btw', 'pi-lens', 'terminate-slop', 'to-spec', 'triage'];
const summary = { enabledCount: 19, totalCount: 26, disabledNames: names };
test('responsive rows preserve names and cell bounds across resize', () => {
  for (const width of [1, 8, 20, 40, 80, 120, 40]) {
    const lines = formatSummary(summary, 'skills', width);
    assert.ok(lines.every(line => visibleWidth(line) <= width));
    const content = lines.slice(2).join('').replaceAll(' ', '');
    for (const name of names) assert.ok(content.includes(name), `${width}: ${name}`);
  }
});
test('all enabled is count only; empty width is safe', () => {
  assert.deepEqual(formatSummary({ totalCount: 31, enabledCount: 31, disabledNames: [] }, 'extensions', 40), ['             31 extensions']);
  assert.deepEqual(formatSummary(summary, 'skills', 0), []);
});
test('grid rows share a left edge, including partial final rows', () => {
  const rows = formatSummary(summary, 'skills', 80).slice(2);
  assert.ok(rows.length > 1);
  assert.equal(rows[0].search(/\S/), rows.at(-1).search(/\S/));
});
test('resource names come from paths, not pinned package sources', () => {
  const metadata = { origin: 'package', source: 'git:github.com/person/pi-lens@abcdef' };
  for (const [path, container, expected] of [
    ['/packages/pi-lens/skills/navigation/SKILL.md', 'skills', 'navigation'],
    ['/packages/pi-lens/index.ts', 'extensions', 'pi-lens'],
    ['/extensions/skill-toggle/src/index.ts', 'extensions', 'skill-toggle'],
  ]) assert.equal(resourceDisplayName({ path, metadata }, container), expected);
});
for (const width of [20, 80]) {
  console.log(`Header preview at ${width} columns:\n` + formatSummary(summary, 'skills', width).join('\n'));
}
