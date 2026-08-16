import { chmodSync, existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

export interface TmuxExecResult { code: number; stdout: string; stderr: string; }
export type TmuxExec = (args: string[], timeout?: number) => Promise<TmuxExecResult>;
export interface TmuxTarget { session: string; window: string; pane: string; cwd: string; }
export type TmuxPaneDirection = "below" | "right";
export type TmuxJobState = "running" | "completed" | "failed" | "muted";

/** Static Pi launch commands remain usable after Pi exits without affecting managed job wrappers. */
export function spawnedPiCommand(command: string): string { return `${command}; exec "\${SHELL:-/bin/zsh}" -l`; }
export function splitDirectionArgs(direction: TmuxPaneDirection): "-v" | "-h" { return direction === "right" ? "-h" : "-v"; }
export interface TmuxJob { version: 1; id: string; command: string; target: TmuxTarget; pane: string; window: string; createdAt: number; silenceSeconds?: number; silenceNotifiedAt?: number; state: TmuxJobState; exitCode?: number; muted: boolean; }
export interface TmuxEvent { job: TmuxJob; kind: "completed" | "failed"; output: string; }

const MAX_OUTPUT_BYTES = 50 * 1024;
const MAX_OUTPUT_LINES = 2_000;

export function tmuxDirectory(agentDir: string): string { return join(agentDir, "tmux-jobs"); }
export function jobPath(agentDir: string, id: string): string { return join(tmuxDirectory(agentDir), `${id}.json`); }
function commandPath(agentDir: string, id: string): string { return join(tmuxDirectory(agentDir), `${id}.command`); }
function signalPath(agentDir: string, id: string): string { return join(tmuxDirectory(agentDir), `${id}.done`); }
function wrapperPath(agentDir: string, id: string): string { return join(tmuxDirectory(agentDir), `${id}.sh`); }

export async function resolveTmuxTarget(exec: TmuxExec, pane = process.env.TMUX_PANE): Promise<TmuxTarget | undefined> {
	if (!process.env.TMUX || !pane) return undefined;
	const result = await exec(["display-message", "-p", "-t", pane, "#{session_name}\t#{window_id}\t#{pane_id}\t#{pane_current_path}"], 3_000);
	if (result.code !== 0) return undefined;
	const [session, window, resolvedPane, cwd] = result.stdout.trim().split("\t");
	return session && window && resolvedPane && cwd ? { session, window, pane: resolvedPane, cwd } : undefined;
}

/** Create a private durable job. Command text is deliberately stored, never interpolated into tmux shell source. */
export function createJob(agentDir: string, command: string, target: TmuxTarget, silenceSeconds?: number): TmuxJob {
	if (!command.trim()) throw new Error("A tmux command is required.");
	if (silenceSeconds !== undefined && (!Number.isInteger(silenceSeconds) || silenceSeconds < 10 || silenceSeconds > 3_600)) throw new Error("silenceSeconds must be an integer from 10 to 3600.");
	const id = `${Date.now()}-${process.pid}-${Math.random().toString(36).slice(2, 10)}`;
	const job: TmuxJob = { version: 1, id, command, target, pane: "", window: "", createdAt: Date.now(), silenceSeconds, state: "running", muted: false };
	writePrivate(agentDir, id, ".command", command);
	// The wrapper has no user-derived shell source. It only executes the private command file.
	writePrivate(agentDir, id, ".sh", "#!/bin/sh\nset +e\n/bin/sh \"$TMUX_JOB_COMMAND\"\nrc=$?\nprintf '%s\\n' \"$rc\" > \"$TMUX_JOB_SIGNAL.tmp\" && mv \"$TMUX_JOB_SIGNAL.tmp\" \"$TMUX_JOB_SIGNAL\"\nexit \"$rc\"\n", 0o700);
	writeJob(agentDir, job);
	return job;
}

export async function launchJob(exec: TmuxExec, agentDir: string, job: TmuxJob, destination: "pane" | "window" = "window"): Promise<TmuxJob> {
	const env = ["-e", `TMUX_JOB_COMMAND=${commandPath(agentDir, job.id)}`, "-e", `TMUX_JOB_SIGNAL=${signalPath(agentDir, job.id)}`];
	const args = destination === "pane"
		? ["split-window", "-d", "-v", "-P", "-F", "#{pane_id}\t#{window_id}", "-t", job.target.pane, "-c", job.target.cwd, ...env, wrapperPath(agentDir, job.id)]
		: ["new-window", "-d", "-P", "-F", "#{pane_id}\t#{window_id}", "-t", job.target.session, "-c", job.target.cwd, ...env, wrapperPath(agentDir, job.id)];
	const result = await exec(args, 5_000);
	if (result.code !== 0) { removeJobFiles(agentDir, job.id); throw new Error(result.stderr.trim() || "tmux launch failed"); }
	const [pane, window] = result.stdout.trim().split("\t");
	if (!pane || !window) { removeJobFiles(agentDir, job.id); throw new Error("tmux did not return a managed pane and window."); }
	const launched = { ...job, pane, window };
	writeJob(agentDir, launched);
	return launched;
}

export function listJobs(agentDir: string): TmuxJob[] {
	const dir = tmuxDirectory(agentDir);
	if (!existsSync(dir)) return [];
	return readdirSync(dir).filter((name) => name.endsWith(".json")).flatMap((name) => {
		try { const job = JSON.parse(readFileSync(join(dir, name), "utf8")); return isJob(job) ? [job] : []; } catch { return []; }
	}).sort((a, b) => a.createdAt - b.createdAt);
}

export function muteJob(agentDir: string, id: string): TmuxJob | undefined {
	const job = readJob(agentDir, id); if (!job) return undefined;
	const muted = { ...job, muted: true, state: job.state === "running" ? "muted" as const : job.state };
	writeJob(agentDir, muted); return muted;
}

export async function peekJob(exec: TmuxExec, agentDir: string, id: string): Promise<{ job: TmuxJob; output: string }> {
	const job = readJob(agentDir, id); if (!job) throw new Error("Unknown managed tmux job.");
	const result = await exec(["capture-pane", "-p", "-t", job.pane, "-S", "-200"], 5_000);
	if (result.code !== 0) throw new Error(result.stderr.trim() || "Could not capture the managed pane.");
	return { job, output: boundOutput(result.stdout) };
}

/** Reconciliation is restart-safe: completion signals remain private files until observed. */
export async function reconcileJobs(exec: TmuxExec, agentDir: string): Promise<TmuxEvent[]> {
	const events: TmuxEvent[] = [];
	for (const job of listJobs(agentDir)) {
		if (job.state !== "running" && job.state !== "muted") continue;
		const signal = signalPath(agentDir, job.id);
		if (!existsSync(signal)) continue;
		let exitCode: number | undefined;
		try { const raw = readFileSync(signal, "utf8").trim(); exitCode = /^-?\d+$/.test(raw) ? Number(raw) : undefined; } catch { continue; }
		if (exitCode === undefined) continue;
		const completed = { ...job, state: exitCode === 0 ? "completed" as const : "failed" as const, exitCode };
		writeJob(agentDir, completed);
		try { unlinkSync(signal); } catch { /* completion is already persisted */ }
		if (!completed.muted) {
			const capture = await exec(["capture-pane", "-p", "-t", completed.pane, "-S", "-40"], 5_000);
			events.push({ job: completed, kind: completed.state === "completed" ? "completed" : "failed", output: capture.code === 0 ? boundOutput(capture.stdout) : "" });
		}
	}
	return events;
}

/** Schedule one durable silence check rather than polling. A restart reschedules from the persisted job record. */
export function scheduleSilence(agentDir: string, id: string, notify: (job: TmuxJob) => void): ReturnType<typeof setTimeout> | undefined {
	const job = readJob(agentDir, id);
	if (!job || !job.silenceSeconds || job.muted || job.state !== "running") return undefined;
	const wait = Math.max(0, job.createdAt + job.silenceSeconds * 1_000 - Date.now());
	return setTimeout(() => {
		const current = readJob(agentDir, id);
		if (!current || current.muted || current.state !== "running" || current.silenceNotifiedAt) return;
		const silent = { ...current, silenceNotifiedAt: Date.now() }; writeJob(agentDir, silent); notify(silent);
	}, wait);
}

export async function attachInGhostty(exec: (command: string, args: string[], timeout?: number) => Promise<TmuxExecResult>, target: TmuxTarget): Promise<void> {
	const result = await exec("open", ["-na", "Ghostty", "--args", "-e", "tmux", "attach-session", "-t", target.session], 5_000);
	if (result.code !== 0) throw new Error(result.stderr.trim() || "Could not open Ghostty.");
}

export function removeJobFiles(agentDir: string, id: string): void { for (const suffix of [".json", ".command", ".done", ".done.tmp", ".sh"]) try { unlinkSync(join(tmuxDirectory(agentDir), `${id}${suffix}`)); } catch { /* absent */ } }
export function boundOutput(output: string): string {
	let lines = output.split("\n"); const lineTruncated = lines.length > MAX_OUTPUT_LINES; if (lineTruncated) lines = lines.slice(-MAX_OUTPUT_LINES);
	let text = lines.join("\n"); let byteTruncated = Buffer.byteLength(text) > MAX_OUTPUT_BYTES;
	while (Buffer.byteLength(text) > MAX_OUTPUT_BYTES) { lines.shift(); text = lines.join("\n"); }
	return text + (lineTruncated || byteTruncated ? "\n\n[Output truncated to the last 2000 lines / 50KB.]" : "");
}
function writePrivate(agentDir: string, id: string, suffix: string, content: string, mode = 0o600): void { const dir = tmuxDirectory(agentDir); mkdirSync(dir, { recursive: true, mode: 0o700 }); chmodSync(dir, 0o700); const path = join(dir, `${id}${suffix}`); writeFileSync(path, content, { encoding: "utf8", mode }); chmodSync(path, mode); }
function writeJob(agentDir: string, job: TmuxJob): void { const path = jobPath(agentDir, job.id); const tmp = `${path}.tmp`; writePrivate(agentDir, job.id, ".json.tmp", JSON.stringify(job)); renameSync(tmp, path); }
function readJob(agentDir: string, id: string): TmuxJob | undefined { const path = jobPath(agentDir, id); if (!isPrivatePath(agentDir, path) || !existsSync(path)) return undefined; try { const stat = lstatSync(path); if (!stat.isFile() || (stat.mode & 0o077) !== 0) return undefined; const value = JSON.parse(readFileSync(path, "utf8")); return isJob(value) ? value : undefined; } catch { return undefined; } }
function isPrivatePath(agentDir: string, path: string): boolean { return resolve(path).startsWith(`${resolve(tmuxDirectory(agentDir))}/`); }
function isJob(value: unknown): value is TmuxJob { if (!value || typeof value !== "object") return false; const job = value as Partial<TmuxJob>; return job.version === 1 && typeof job.id === "string" && typeof job.command === "string" && isTarget(job.target) && typeof job.pane === "string" && typeof job.window === "string" && typeof job.createdAt === "number" && (job.silenceSeconds === undefined || Number.isInteger(job.silenceSeconds)) && (job.state === "running" || job.state === "completed" || job.state === "failed" || job.state === "muted") && typeof job.muted === "boolean" && (job.silenceNotifiedAt === undefined || Number.isInteger(job.silenceNotifiedAt)) && (job.exitCode === undefined || Number.isInteger(job.exitCode)); }
function isTarget(value: unknown): value is TmuxTarget { return !!value && typeof value === "object" && typeof (value as TmuxTarget).session === "string" && typeof (value as TmuxTarget).window === "string" && typeof (value as TmuxTarget).pane === "string" && typeof (value as TmuxTarget).cwd === "string"; }
