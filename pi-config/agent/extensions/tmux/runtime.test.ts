import assert from "node:assert/strict";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { boundOutput, createJob, jobPath, launchJob, listJobs, muteJob, reconcileJobs, resolveTmuxTarget, type TmuxExec } from "./runtime.ts";

const target = { session: "work", window: "@1", pane: "%2", cwd: "/tmp/work" };
const calls: string[][] = [];
const exec: TmuxExec = async (args) => { calls.push(args); if (args[0] === "display-message") return { code: 0, stdout: "work\t@1\t%2\t/tmp/work\n", stderr: "" }; if (args[0] === "new-window" || args[0] === "split-window") return { code: 0, stdout: "%9\t@8\n", stderr: "" }; return { code: 0, stdout: "log\n", stderr: "" }; };

test("runtime resolves active target and launches a private argv-only job", async () => {
	const dir = mkdtempSync(join(tmpdir(), "pi-tmux-")); const previous = process.env.TMUX; const previousPane = process.env.TMUX_PANE;
	try {
		process.env.TMUX = "/tmp/tmux"; process.env.TMUX_PANE = "%2";
		assert.deepEqual(await resolveTmuxTarget(exec), target);
		const job = createJob(dir, "echo 'quoted; command'", target);
		assert.equal(existsSync(jobPath(dir, job.id)), true);
		const launched = await launchJob(exec, dir, job);
		assert.equal(launched.pane, "%9"); assert.equal(launched.window, "@8");
		const launch = calls.at(-1)!; assert.equal(launch[0], "new-window"); assert.ok(launch.includes(`TMUX_JOB_COMMAND=${join(dir, "tmux-jobs", `${job.id}.command`)}`)); assert.equal(launch.some((arg) => arg.includes("quoted; command")), false);
	} finally { process.env.TMUX = previous; process.env.TMUX_PANE = previousPane; rmSync(dir, { recursive: true, force: true }); }
});

test("completion is durable, mute suppresses notification, and output is bounded", async () => {
	const dir = mkdtempSync(join(tmpdir(), "pi-tmux-"));
	try {
		let job = await launchJob(exec, dir, createJob(dir, "true", target));
		writeFileSync(join(dir, "tmux-jobs", `${job.id}.done`), "0\n", { mode: 0o600 });
		const events = await reconcileJobs(exec, dir); assert.equal(events.length, 1); assert.equal(events[0]!.kind, "completed");
		job = await launchJob(exec, dir, createJob(dir, "false", target)); muteJob(dir, job.id); writeFileSync(join(dir, "tmux-jobs", `${job.id}.done`), "1\n", { mode: 0o600 }); assert.equal((await reconcileJobs(exec, dir)).length, 0); assert.equal(listJobs(dir).find((item) => item.id === job.id)?.state, "failed");
		const output = boundOutput(Array.from({ length: 2_100 }, (_, index) => `line-${index}`).join("\n")); assert.match(output, /Output truncated/); assert.match(output, /line-2099/);
	} finally { rmSync(dir, { recursive: true, force: true }); }
});
