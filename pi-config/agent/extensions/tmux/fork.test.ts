import assert from "node:assert/strict";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { buildForkPaneArgs, forkSessionAtCurrentPoint, launchForkPane } from "./fork.ts";
import type { TmuxExec } from "./runtime.ts";

const target = { session: "work", window: "@1", pane: "%2", cwd: "/tmp/work" };

test("fork delegates exact source and current leaf to an isolated session manager", () => {
	const dir = mkdtempSync(join(tmpdir(), "pi-tmux-fork-"));
	try {
		const sourceFile = join(dir, "source.jsonl"); const forkPath = join(dir, "fork.jsonl"); writeFileSync(sourceFile, "source\n");
		let opened: string[] | undefined; let requestedLeaf: string | undefined;
		const result = forkSessionAtCurrentPoint((path, sessionDir) => { opened = [path, sessionDir]; return { createBranchedSession(leafId) { requestedLeaf = leafId; writeFileSync(forkPath, "fork\n"); return forkPath; } }; }, sourceFile, "leaf-123");
		assert.deepEqual(opened, [sourceFile, dir]); assert.equal(requestedLeaf, "leaf-123"); assert.equal(result, forkPath); assert.equal(existsSync(forkPath), true);
	} finally { rmSync(dir, { recursive: true, force: true }); }
});

test("fork pane is detached, preserves cwd and focus target, and passes no session text as shell source", async () => {
	const path = "/tmp/session with spaces.jsonl";
	const args = buildForkPaneArgs(target, path);
	assert.deepEqual(args.slice(0, 7), ["split-window", "-d", "-v", "-P", "-F", "#{pane_id}\t#{window_id}", "-t"]);
	assert.ok(args.includes(target.pane));
	assert.ok(args.includes(target.cwd));
	assert.ok(args.includes(`PI_TMUX_FORK_SESSION=${path}`));
	assert.equal(args.at(-1), "pi --session \"$PI_TMUX_FORK_SESSION\"; exec \"${SHELL:-/bin/zsh}\" -l");
	assert.ok(buildForkPaneArgs(target, path, "right").includes("-h"));
	const exec: TmuxExec = async () => ({ code: 0, stdout: "%9\t@1\n", stderr: "" });
	assert.deepEqual(await launchForkPane(exec, target, path, "right"), { pane: "%9", window: "@1" });
});

test("failed pane launch removes only the newly created fork file", async () => {
	const dir = mkdtempSync(join(tmpdir(), "pi-tmux-fork-"));
	try {
		const path = join(dir, "fork.jsonl"); writeFileSync(path, "fork\n");
		const exec: TmuxExec = async () => ({ code: 1, stdout: "", stderr: "split failed" });
		await assert.rejects(launchForkPane(exec, target, path), /split failed/);
		assert.equal(existsSync(path), false);
	} finally { rmSync(dir, { recursive: true, force: true }); }
});
