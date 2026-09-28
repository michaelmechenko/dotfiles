import assert from "node:assert/strict";
import { mkdtemp, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { prepareOutputCapture } from "./result-artifacts.ts";

test("truncated output is retained in a private artifact with the real path", async () => {
	const stateHome = await mkdtemp(path.join(os.tmpdir(), "pi-subagent-artifacts-test-"));
	const previous = process.env.XDG_STATE_HOME;
	process.env.XDG_STATE_HOME = stateHome;
	try {
		const capture = await prepareOutputCapture("researcher", 32);
		const full = "research result\n".repeat(100);
		const result = capture(full);
		assert.equal(result.truncated, true);
		assert.ok(result.artifact);
		assert.equal(await readFile(result.artifact.path, "utf8"), full);
		assert.equal((await stat(result.artifact.path)).mode & 0o777, 0o600);
		assert.equal((await stat(path.dirname(result.artifact.path))).mode & 0o777, 0o700);
		assert.ok(Buffer.byteLength(result.preview, "utf8") <= 32);
	} finally {
		if (previous === undefined) delete process.env.XDG_STATE_HOME;
		else process.env.XDG_STATE_HOME = previous;
		await rm(stateHome, { recursive: true, force: true });
	}
});

test("retention stays at 64 and one capture keeps only its latest oversized turn", async () => {
	const stateHome = await mkdtemp(path.join(os.tmpdir(), "pi-subagent-artifacts-test-"));
	const previous = process.env.XDG_STATE_HOME;
	process.env.XDG_STATE_HOME = stateHome;
	try {
		const dir = path.join(stateHome, "pi", "subagent-results");
		const capture = await prepareOutputCapture("worker", 8);
		for (let index = 0; index < 64; index++) await writeFile(path.join(dir, `result-existing-${index}.md`), "old", { mode: 0o600 });
		const first = capture("first oversized output");
		const second = capture("second oversized output");
		assert.ok(first.artifact && second.artifact);
		assert.notEqual(first.artifact.path, second.artifact.path);
		await assert.rejects(readFile(first.artifact.path, "utf8"), /ENOENT/);
		assert.equal(await readFile(second.artifact.path, "utf8"), "second oversized output");
		assert.equal((await readdir(dir)).filter((name) => name.startsWith("result-")).length, 64);
	} finally {
		if (previous === undefined) delete process.env.XDG_STATE_HOME;
		else process.env.XDG_STATE_HOME = previous;
		await rm(stateHome, { recursive: true, force: true });
	}
});

test("small output stays memory-only", async () => {
	const stateHome = await mkdtemp(path.join(os.tmpdir(), "pi-subagent-artifacts-test-"));
	const previous = process.env.XDG_STATE_HOME;
	process.env.XDG_STATE_HOME = stateHome;
	try {
		const capture = await prepareOutputCapture("scout", 1024);
		assert.deepEqual(capture("small result"), { preview: "small result", truncated: false });
	} finally {
		if (previous === undefined) delete process.env.XDG_STATE_HOME;
		else process.env.XDG_STATE_HOME = previous;
		await rm(stateHome, { recursive: true, force: true });
	}
});
