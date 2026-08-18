import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, realpathSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { canonicalSessionPath } from "../session-path.ts";

const root = mkdtempSync(join(tmpdir(), "pi-session-root-"));
const nested = join(root, "project");
mkdirSync(nested);
const inside = join(nested, "session.jsonl");
const outside = join(tmpdir(), `pi-outside-${Date.now()}.jsonl`);
writeFileSync(inside, "{}");
writeFileSync(outside, "{}");
symlinkSync(outside, join(nested, "escape.jsonl"));

test("only accepts canonical Pi session files below the sessions root", () => {
	assert.equal(canonicalSessionPath(inside, root), realpathSync.native(inside));
	assert.equal(canonicalSessionPath(outside, root), undefined);
	assert.equal(canonicalSessionPath(join(nested, "escape.jsonl"), root), undefined);
	assert.equal(canonicalSessionPath(join(nested, "not-json.txt"), root), undefined);
});
