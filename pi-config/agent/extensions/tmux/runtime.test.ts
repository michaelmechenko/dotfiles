import assert from "node:assert/strict";
import { chmodSync, existsSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
	acknowledgeJobEvent,
	attachInGhostty,
	boundOutput,
	claimJobEvent,
	createJob,
	jobPath,
	launchJob,
	listJobs,
	muteJob,
	ownerMatches,
	peekJob,
	reconcileJobs,
	refreshJobActivity,
	releaseJobEventClaims,
	resolveTmuxTarget,
	retainedLogPath,
	spawnedPiCommand,
	splitDirectionArgs,
	type TmuxExec,
	type TmuxJobOwner,
	type TmuxOwnerContext,
} from "./runtime.ts";

const target = { socket: "/tmp/tmux-test/default", session: "work", window: "@1", pane: "%2", cwd: "/tmp/work" };
const owner: TmuxJobOwner = { piSessionId: "pi-session", piBranchId: "branch-root", tmuxSocket: target.socket, tmuxSession: target.session };
const access: TmuxOwnerContext = { piSessionId: owner.piSessionId, tmuxSocket: owner.tmuxSocket, tmuxSession: owner.tmuxSession, branchIds: ["branch-root", "branch-child"] };
const calls: string[][] = [];
const exec: TmuxExec = async (args) => {
	calls.push(args);
	if (args[0] === "display-message") return { code: 0, stdout: `${target.socket}\twork\t@1\t%2\t/tmp/work\n`, stderr: "" };
	if (args[0] === "new-window" || args[0] === "split-window") return { code: 0, stdout: "%9\t@8\n", stderr: "" };
	if (args[0] === "pipe-pane") return { code: 0, stdout: "", stderr: "" };
	return { code: 1, stdout: "", stderr: "pane is gone" };
};

function marker(dir: string, id: string, suffix: string, content = ""): void {
	const path = join(dir, "tmux-jobs", `${id}${suffix}`);
	writeFileSync(path, content, { mode: 0o600 });
	chmodSync(path, 0o600);
}

test("spawned Pi commands retain a login shell and split placement is explicit", () => {
	assert.equal(spawnedPiCommand("pi --session x"), "pi --session x; exec \"${SHELL:-/bin/zsh}\" -l");
	assert.equal(splitDirectionArgs("below"), "-v");
	assert.equal(splitDirectionArgs("right"), "-h");
});

test("runtime resolves socket identity and launches gated private logging", async () => {
	const dir = mkdtempSync(join(tmpdir(), "pi-tmux-")); const previous = process.env.TMUX; const previousPane = process.env.TMUX_PANE;
	try {
		process.env.TMUX = "/tmp/tmux"; process.env.TMUX_PANE = "%2";
		assert.deepEqual(await resolveTmuxTarget(exec), target);
		const job = createJob(dir, "echo 'quoted; command'", target, owner);
		assert.equal(existsSync(jobPath(dir, job.id)), true);
		const launched = await launchJob(exec, dir, job);
		assert.equal(launched.pane, "%9"); assert.equal(launched.window, "@8"); assert.equal(launched.logReady, true);
		const launch = calls.findLast((item) => item[0] === "new-window")!;
		assert.ok(launch.includes(`TMUX_JOB_COMMAND=${join(dir, "tmux-jobs", `${job.id}.command`)}`));
		assert.equal(launch.some((arg) => arg.includes("quoted; command")), false);
		const pipe = calls.findLast((item) => item[0] === "pipe-pane")!;
		assert.equal(pipe[2], launched.pane);
		assert.equal(pipe.includes("-o"), false);
		assert.equal(existsSync(join(dir, "tmux-jobs", `${job.id}.start`)), true);
		assert.equal(statSync(retainedLogPath(dir, job.id)).mode & 0o777, 0o600);
	} finally { process.env.TMUX = previous; process.env.TMUX_PANE = previousPane; rmSync(dir, { recursive: true, force: true }); }
});

test("logger setup failure releases the bounded start gate and retains pane identity", async () => {
	const dir = mkdtempSync(join(tmpdir(), "pi-tmux-"));
	const failingExec: TmuxExec = async (args) => {
		if (args[0] === "new-window") return { code: 0, stdout: "%77\t@77\n", stderr: "" };
		if (args[0] === "pipe-pane") throw new Error("pipe setup exploded");
		return { code: 0, stdout: "", stderr: "" };
	};
	try {
		const launched = await launchJob(failingExec, dir, createJob(dir, "true", target, owner));
		assert.equal(launched.pane, "%77"); assert.equal(launched.window, "@77"); assert.equal(launched.logReady, false);
		assert.match(launched.logError || "", /pipe setup exploded/);
		assert.equal(existsSync(join(dir, "tmux-jobs", `${launched.id}.start`)), true);
	} finally { rmSync(dir, { recursive: true, force: true }); }
});

test("completion survives pane loss, is owner-routed, acknowledged once, and ignores stale markers", async () => {
	const dir = mkdtempSync(join(tmpdir(), "pi-tmux-"));
	try {
		const job = await launchJob(exec, dir, createJob(dir, "printf done", target, owner));
		marker(dir, job.id, ".log", "\u001b[31mretained output\u001b[0m\n");
		marker(dir, job.id, ".log.done");
		marker(dir, job.id, ".done", "0\n");
		const wrongOwner = { ...access, piSessionId: "another-session" };
		assert.equal((await reconcileJobs(exec, dir, wrongOwner)).length, 0);
		await assert.rejects(peekJob(exec, dir, job.id, wrongOwner), /belongs to another/);
		const events = await reconcileJobs(exec, dir, access);
		assert.equal(events.length, 1);
		assert.equal(events[0]!.kind, "completed");
		assert.equal(events[0]!.output, "retained output\n");
		assert.equal(ownerMatches(events[0]!.job, access), true);
		assert.equal(claimJobEvent(dir, job.id, events[0]!.eventId, "test-claimant"), true);
		assert.equal(claimJobEvent(dir, job.id, events[0]!.eventId, "other-live-claimant"), false);
		releaseJobEventClaims(dir, "test-claimant");
		assert.equal(claimJobEvent(dir, job.id, events[0]!.eventId, "restart-claimant"), true);
		assert.equal(acknowledgeJobEvent(dir, job.id, events[0]!.eventId, "restart-claimant"), true);
		assert.equal((await reconcileJobs(exec, dir, access)).length, 0);
		marker(dir, job.id, ".done", "0\n");
		assert.equal((await reconcileJobs(exec, dir, access)).length, 0);
		assert.equal(readFileSync(retainedLogPath(dir, job.id), "utf8").includes("retained output"), true);
	} finally { rmSync(dir, { recursive: true, force: true }); }
});

test("mute suppresses pending delivery and legacy version-1 records remain readable without notification", async () => {
	const dir = mkdtempSync(join(tmpdir(), "pi-tmux-"));
	try {
		let job = await launchJob(exec, dir, createJob(dir, "false", target, owner));
		muteJob(dir, job.id, access);
		marker(dir, job.id, ".log", "late output\n");
		const merged = refreshJobActivity(dir, { ...job, lastOutputAt: 0 });
		assert.equal(merged.muted, true); assert.equal(merged.state, "muted");
		marker(dir, job.id, ".log.done"); marker(dir, job.id, ".done", "1\n");
		assert.equal((await reconcileJobs(exec, dir, access)).length, 0);
		assert.equal(listJobs(dir).find((item) => item.id === job.id)?.state, "failed");

		const legacyId = `${Date.now()}-${process.pid}-legacy01`;
		const legacy = { version: 1, id: legacyId, command: "legacy", target: { session: "work", window: "@1", pane: "%404", cwd: "/tmp" }, pane: "%404", window: "@1", createdAt: Date.now(), state: "running", muted: false };
		marker(dir, legacyId, ".json", JSON.stringify(legacy)); marker(dir, legacyId, ".done", "0\n");
		assert.equal((await reconcileJobs(exec, dir, access)).length, 0);
		assert.equal(listJobs(dir).find((item) => item.id === legacyId)?.state, "completed");
	} finally { rmSync(dir, { recursive: true, force: true }); }
});

test("Ghostty attachment pins the originating tmux socket", async () => {
	let invocation: { command: string; args: string[] } | undefined;
	await attachInGhostty(async (command, args) => { invocation = { command, args }; return { code: 0, stdout: "", stderr: "" }; }, target);
	assert.ok(invocation?.args.includes("-S"));
	assert.ok(invocation?.args.includes(target.socket));
});

test("bounded output keeps the tail and includes its marker inside 50 KiB", () => {
	const output = boundOutput(Array.from({ length: 2_100 }, (_, index) => `line-${index}`).join("\n"));
	assert.match(output, /Output truncated/); assert.match(output, /line-2099/);
	const wide = boundOutput("é".repeat(100_000));
	assert.ok(Buffer.byteLength(wide, "utf8") <= 50 * 1024);
	assert.match(wide, /Output truncated/);
});
