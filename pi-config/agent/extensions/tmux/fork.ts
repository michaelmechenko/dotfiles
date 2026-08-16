import { existsSync, unlinkSync } from "node:fs";
import { dirname } from "node:path";
import type { TmuxExec, TmuxTarget } from "./runtime.ts";

interface BranchSession { createBranchedSession(leafId: string): string | undefined; }
type OpenSession = (sessionFile: string, sessionDir: string) => BranchSession;

export function forkSessionAtCurrentPoint(openSession: OpenSession, sessionFile: string, leafId: string): string {
	if (!existsSync(sessionFile)) throw new Error("The current session has not been saved yet.");
	const clone = openSession(sessionFile, dirname(sessionFile));
	const forkPath = clone.createBranchedSession(leafId);
	if (!forkPath || !existsSync(forkPath)) throw new Error("Could not create the forked session.");
	return forkPath;
}

export function buildForkPaneArgs(target: TmuxTarget, forkPath: string): string[] {
	return [
		"split-window", "-d", "-v", "-P", "-F", "#{pane_id}\t#{window_id}",
		"-t", target.pane, "-c", target.cwd,
		"-e", `PI_TMUX_FORK_SESSION=${forkPath}`,
		"pi --session \"$PI_TMUX_FORK_SESSION\"",
	];
}

export async function launchForkPane(exec: TmuxExec, target: TmuxTarget, forkPath: string): Promise<{ pane: string; window: string }> {
	const result = await exec(buildForkPaneArgs(target, forkPath), 5_000);
	if (result.code !== 0) {
		try { unlinkSync(forkPath); } catch { /* rollback only the fork created for this launch */ }
		throw new Error(result.stderr.trim() || "Could not launch the forked tmux pane.");
	}
	const [pane, window] = result.stdout.trim().split("\t");
	if (!pane || !window) {
		try { unlinkSync(forkPath); } catch { /* rollback only the fork created for this launch */ }
		throw new Error("tmux did not return the forked pane target.");
	}
	return { pane, window };
}
