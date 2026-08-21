import assert from "node:assert/strict";
import test from "node:test";
import { mkdir, mkdtemp, rm, symlink } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { samePath } from "./path-equivalence.ts";

test("symlink-equivalent roots resolve to the same real path", async () => {
	const base = await mkdtemp(join(tmpdir(), "path-equiv-"));
	const real = join(base, "real");
	await mkdir(real);
	const link = join(base, "link");
	await symlink(real, link);
	try {
		assert.equal(await samePath(link, real), true);
		assert.equal(await samePath(real, link), true);
	} finally {
		await rm(base, { recursive: true, force: true });
	}
});

test("genuinely distinct roots are not equivalent", async () => {
	const base = await mkdtemp(join(tmpdir(), "path-distinct-"));
	const a = join(base, "a");
	const b = join(base, "b");
	await mkdir(a);
	await mkdir(b);
	try {
		assert.equal(await samePath(a, b), false);
	} finally {
		await rm(base, { recursive: true, force: true });
	}
});

test("unresolvable paths fall back to string equality", async () => {
	// A dangling symlink's realpath throws; equality should be judged on the
	// literal strings so two identical dangling references stay "the same".
	const base = await mkdtemp(join(tmpdir(), "path-dangling-"));
	const a = join(base, "missing");
	try {
		assert.equal(await samePath(a, a), true);
		assert.equal(await samePath(a, join(base, "other")), false);
	} finally {
		await rm(base, { recursive: true, force: true });
	}
});
