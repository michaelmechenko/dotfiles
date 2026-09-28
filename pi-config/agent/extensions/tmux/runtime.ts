import { chmodSync, closeSync, existsSync, lstatSync, mkdirSync, openSync, readFileSync, readSync, readdirSync, renameSync, statSync, unlinkSync, writeFileSync, watch, type FSWatcher } from "node:fs";
import { join, resolve } from "node:path";
import { stripVTControlCharacters } from "node:util";
import { DatabaseSync } from "node:sqlite";

export interface TmuxExecResult { code: number; stdout: string; stderr: string; }
export type TmuxExec = (args: string[], timeout?: number) => Promise<TmuxExecResult>;
export interface TmuxTarget { socket: string; session: string; window: string; pane: string; cwd: string; }
export type TmuxPaneDirection = "below" | "right";
export type TmuxJobState = "running" | "completed" | "failed" | "muted";

/** Static Pi launch commands remain usable after Pi exits without affecting managed job wrappers. */
export function spawnedPiCommand(command: string): string { return `${command}; exec "\${SHELL:-/bin/zsh}" -l`; }
export function splitDirectionArgs(direction: TmuxPaneDirection): "-v" | "-h" { return direction === "right" ? "-h" : "-v"; }

export interface TmuxJobOwner {
	piSessionId: string;
	piBranchId: string;
	tmuxSocket: string;
	tmuxSession: string;
}
export interface TmuxOwnerContext {
	piSessionId: string;
	tmuxSocket: string;
	tmuxSession: string;
	branchIds: string[];
}
interface TmuxJobBase {
	id: string;
	command: string;
	target: TmuxTarget;
	pane: string;
	window: string;
	createdAt: number;
	silenceSeconds?: number;
	silenceNotifiedAt?: number;
	state: TmuxJobState;
	exitCode?: number;
	muted: boolean;
}
export interface TmuxJobV1 extends Omit<TmuxJobBase, "target"> {
	version: 1;
	target: Omit<TmuxTarget, "socket">;
}
export interface TmuxCompletion {
	eventId: string;
	observedAt: number;
	acknowledgedAt?: number;
}
export interface TmuxJobV2 extends TmuxJobBase {
	version: 2;
	owner: TmuxJobOwner;
	lastOutputAt: number;
	logReady: boolean;
	logError?: string;
	completion?: TmuxCompletion;
}
export type TmuxJob = TmuxJobV1 | TmuxJobV2;
export interface TmuxEvent { job: TmuxJobV2; eventId: string; kind: "completed" | "failed"; output: string; logPath: string; }

const MAX_OUTPUT_BYTES = 50 * 1024;
const MAX_OUTPUT_LINES = 2_000;
const ID_PATTERN = /^\d{10,}-\d+-[a-z0-9]+$/;

export function tmuxDirectory(agentDir: string): string { return join(agentDir, "tmux-jobs"); }
export function ensureTmuxDirectory(agentDir: string): string {
	const dir = tmuxDirectory(agentDir);
	mkdirSync(dir, { recursive: true, mode: 0o700 });
	chmodSync(dir, 0o700);
	return dir;
}
export function jobPath(agentDir: string, id: string): string { return join(tmuxDirectory(agentDir), `${id}.json`); }
function commandPath(agentDir: string, id: string): string { return join(tmuxDirectory(agentDir), `${id}.command`); }
function signalPath(agentDir: string, id: string): string { return join(tmuxDirectory(agentDir), `${id}.done`); }
function wrapperPath(agentDir: string, id: string): string { return join(tmuxDirectory(agentDir), `${id}.sh`); }
function loggerPath(agentDir: string, id: string): string { return join(tmuxDirectory(agentDir), `${id}.logger.cjs`); }
function logPath(agentDir: string, id: string): string { return join(tmuxDirectory(agentDir), `${id}.log`); }
function logDonePath(agentDir: string, id: string): string { return join(tmuxDirectory(agentDir), `${id}.log.done`); }
function logTruncatedPath(agentDir: string, id: string): string { return join(tmuxDirectory(agentDir), `${id}.log.truncated`); }
function logFailedPath(agentDir: string, id: string): string { return join(tmuxDirectory(agentDir), `${id}.log.failed`); }
function logFallbackPath(agentDir: string, id: string): string { return join(tmuxDirectory(agentDir), `${id}.log.fallback`); }
function startPath(agentDir: string, id: string): string { return join(tmuxDirectory(agentDir), `${id}.start`); }
export function retainedLogPath(agentDir: string, id: string): string { return logPath(agentDir, id); }

export async function resolveTmuxTarget(exec: TmuxExec, pane = process.env.TMUX_PANE): Promise<TmuxTarget | undefined> {
	if (!process.env.TMUX || !pane) return undefined;
	const result = await exec(["display-message", "-p", "-t", pane, "#{socket_path}\t#{session_name}\t#{window_id}\t#{pane_id}\t#{pane_current_path}"], 3_000);
	if (result.code !== 0) return undefined;
	const [socket, session, window, resolvedPane, cwd] = result.stdout.trim().split("\t");
	return socket && session && window && resolvedPane && cwd ? { socket, session, window, pane: resolvedPane, cwd } : undefined;
}

export function ownerMatches(job: TmuxJob, owner: TmuxOwnerContext): boolean {
	return job.version === 2
		&& job.owner.piSessionId === owner.piSessionId
		&& job.owner.tmuxSocket === owner.tmuxSocket
		&& job.owner.tmuxSession === owner.tmuxSession
		&& owner.branchIds.includes(job.owner.piBranchId);
}

/** Create a private durable job. Command text is deliberately stored, never interpolated into tmux shell source. */
export function createJob(agentDir: string, command: string, target: TmuxTarget, owner: TmuxJobOwner, silenceSeconds?: number): TmuxJobV2 {
	if (!command.trim()) throw new Error("A tmux command is required.");
	if (silenceSeconds !== undefined && (!Number.isInteger(silenceSeconds) || silenceSeconds < 10 || silenceSeconds > 3_600)) throw new Error("silenceSeconds must be an integer from 10 to 3600.");
	if (owner.tmuxSocket !== target.socket || owner.tmuxSession !== target.session) throw new Error("Tmux job owner does not match the launch target.");
	const createdAt = Date.now();
	const id = `${createdAt}-${process.pid}-${Math.random().toString(36).slice(2, 10)}`;
	const job: TmuxJobV2 = { version: 2, id, command, target, owner, pane: "", window: "", createdAt, lastOutputAt: createdAt, silenceSeconds, state: "running", muted: false, logReady: false };
	writePrivate(agentDir, id, ".command", command);
	writePrivate(agentDir, id, ".log", "");
	writePrivate(agentDir, id, ".sh", "#!/bin/sh\nset +e\numask 077\nwaited=0\nwhile [ ! -e \"$TMUX_JOB_START\" ] && [ \"$waited\" -lt 250 ]; do sleep 0.02; waited=$((waited + 1)); done\n/bin/sh \"$TMUX_JOB_COMMAND\"\nrc=$?\nprintf '%s\\n' \"$rc\" > \"$TMUX_JOB_SIGNAL.tmp\" && mv \"$TMUX_JOB_SIGNAL.tmp\" \"$TMUX_JOB_SIGNAL\"\n( sleep 2; : > \"$TMUX_JOB_FALLBACK.tmp\" && mv \"$TMUX_JOB_FALLBACK.tmp\" \"$TMUX_JOB_FALLBACK\" ) </dev/null >/dev/null 2>&1 &\nexit \"$rc\"\n", 0o700);
	writePrivate(agentDir, id, ".logger.cjs", "const fs = require('node:fs');\nconst [log, done, truncated, failed] = process.argv.slice(2);\nconst cap = 64 * 1024 * 1024;\nlet written = 0;\nlet marked = false;\nlet fd;\nfunction failure(error) { try { fs.writeFileSync(failed, String(error?.message || error || 'logger failed').slice(0, 4096), { mode: 0o600 }); } catch {} }\nprocess.on('uncaughtException', (error) => { failure(error); process.exit(1); });\nprocess.on('unhandledRejection', (error) => { failure(error); process.exit(1); });\ntry { fd = fs.openSync(log, 'w', 0o600); } catch (error) { failure(error); process.exit(1); }\nfunction mark() { if (marked) return; marked = true; fs.writeFileSync(truncated, '', { mode: 0o600 }); }\nprocess.stdin.on('data', (chunk) => { const remaining = cap - written; if (remaining > 0) { const part = chunk.subarray(0, remaining); fs.writeSync(fd, part); written += part.length; } if (chunk.length > remaining) mark(); });\nprocess.stdin.on('end', () => { fs.closeSync(fd); const temporary = `${done}.${process.pid}.tmp`; fs.writeFileSync(temporary, '', { mode: 0o600 }); fs.renameSync(temporary, done); });\nprocess.stdin.on('error', (error) => { failure(error); try { fs.closeSync(fd); } catch {} process.exitCode = 1; });\n", 0o600);
	return writeJob(agentDir, job) as TmuxJobV2;
}

function shellQuote(value: string): string { return `'${value.replace(/'/g, `'"'"'`)}'`; }

export async function launchJob(exec: TmuxExec, agentDir: string, job: TmuxJobV2, destination: "pane" | "window" = "window"): Promise<TmuxJobV2> {
	const env = ["-e", `TMUX_JOB_COMMAND=${commandPath(agentDir, job.id)}`, "-e", `TMUX_JOB_SIGNAL=${signalPath(agentDir, job.id)}`, "-e", `TMUX_JOB_START=${startPath(agentDir, job.id)}`, "-e", `TMUX_JOB_FALLBACK=${logFallbackPath(agentDir, job.id)}`];
	const args = destination === "pane"
		? ["split-window", "-d", "-v", "-P", "-F", "#{pane_id}\t#{window_id}", "-t", job.target.pane, "-c", job.target.cwd, ...env, wrapperPath(agentDir, job.id)]
		: ["new-window", "-d", "-P", "-F", "#{pane_id}\t#{window_id}", "-t", job.target.session, "-c", job.target.cwd, ...env, wrapperPath(agentDir, job.id)];
	const result = await exec(args, 5_000);
	if (result.code !== 0) { removeUnlaunchedJobFiles(agentDir, job.id); throw new Error(result.stderr.trim() || "tmux launch failed"); }
	const [pane, window] = result.stdout.trim().split("\t");
	if (!pane || !window) {
		writePrivate(agentDir, job.id, ".start", "");
		throw new Error("tmux did not return a managed pane and window; its job record was retained.");
	}
	const launched: TmuxJobV2 = { ...job, pane, window, logReady: false, logError: "tmux pipe-pane logger setup pending" };
	let persisted = launched;
	try {
		persisted = writeJob(agentDir, launched) as TmuxJobV2;
		const pipeCommand = `${shellQuote(process.execPath)} ${shellQuote(loggerPath(agentDir, job.id))} ${shellQuote(logPath(agentDir, job.id))} ${shellQuote(logDonePath(agentDir, job.id))} ${shellQuote(logTruncatedPath(agentDir, job.id))} ${shellQuote(logFailedPath(agentDir, job.id))}`;
		try {
			const piped = await exec(["pipe-pane", "-t", pane, pipeCommand], 5_000);
			persisted = writeJob(agentDir, { ...persisted, logReady: piped.code === 0, logError: piped.code === 0 ? undefined : (piped.stderr.trim() || "tmux pipe-pane logging failed") }) as TmuxJobV2;
		} catch (error) {
			persisted = writeJob(agentDir, { ...persisted, logReady: false, logError: error instanceof Error ? error.message : String(error) }) as TmuxJobV2;
		}
		return persisted;
	} finally {
		try { writePrivate(agentDir, job.id, ".start", ""); } catch { /* wrapper has a bounded gate timeout */ }
	}
}

export function listJobs(agentDir: string): TmuxJob[] {
	const dir = tmuxDirectory(agentDir);
	if (!existsSync(dir)) return [];
	return readdirSync(dir).filter((name) => name.endsWith(".json")).flatMap((name) => {
		try {
			const path = join(dir, name);
			const stat = lstatSync(path);
			if (!stat.isFile() || (stat.mode & 0o077) !== 0) return [];
			const job = JSON.parse(readFileSync(path, "utf8"));
			return isJob(job) ? [job] : [];
		} catch { return []; }
	}).sort((a, b) => a.createdAt - b.createdAt);
}

export function getJob(agentDir: string, id: string): TmuxJob | undefined { return readJob(agentDir, id); }

export function muteJob(agentDir: string, id: string, owner?: TmuxOwnerContext): TmuxJob | undefined {
	const job = readJob(agentDir, id);
	if (!job || (job.version === 2 && owner && !ownerMatches(job, owner))) return undefined;
	const completion = job.version === 2 && job.completion && !job.completion.acknowledgedAt ? { ...job.completion, acknowledgedAt: Date.now() } : job.version === 2 ? job.completion : undefined;
	const muted = { ...job, muted: true, state: job.state === "running" ? "muted" as const : job.state, ...(job.version === 2 ? { completion } : {}) } as TmuxJob;
	return writeJob(agentDir, muted);
}

export async function peekJob(_exec: TmuxExec, agentDir: string, id: string, owner?: TmuxOwnerContext): Promise<{ job: TmuxJob; output: string; logPath?: string }> {
	const job = readJob(agentDir, id);
	if (!job) throw new Error("Unknown managed tmux job.");
	if (job.version === 2) {
		if (owner && !ownerMatches(job, owner)) throw new Error("Managed tmux job belongs to another Pi session, branch, or tmux server.");
		return { job, output: readBoundedLog(agentDir, job.id), logPath: logPath(agentDir, job.id) };
	}
	throw new Error("Legacy managed tmux job has no verified owner or retained log; only its metadata is readable.");
}

function readPrivateInteger(path: string): number | undefined {
	try {
		const stat = lstatSync(path);
		if (!stat.isFile() || (stat.mode & 0o077) !== 0) return undefined;
		const raw = readFileSync(path, "utf8").trim();
		if (!/^-?\d+$/.test(raw)) return undefined;
		const value = Number(raw);
		return Number.isSafeInteger(value) ? value : undefined;
	} catch { return undefined; }
}
function privateMarkerExists(path: string): boolean {
	try { const stat = lstatSync(path); return stat.isFile() && (stat.mode & 0o077) === 0; } catch { return false; }
}
function readPrivateText(path: string, cap = 4096): string | undefined {
	try {
		const stat = lstatSync(path);
		if (!stat.isFile() || (stat.mode & 0o077) !== 0 || stat.size > cap) return undefined;
		return readFileSync(path, "utf8");
	} catch { return undefined; }
}

function logActivityAt(agentDir: string, job: TmuxJobV2): number {
	try {
		const stat = statSync(logPath(agentDir, job.id));
		return stat.size > 0 ? Math.max(job.createdAt, stat.mtimeMs) : job.createdAt;
	} catch { return job.lastOutputAt || job.createdAt; }
}

export function refreshJobActivity(agentDir: string, job: TmuxJobV2): TmuxJobV2 {
	const activityAt = logActivityAt(agentDir, job);
	if (activityAt <= job.lastOutputAt) return job;
	const refreshed = { ...job, lastOutputAt: activityAt, silenceNotifiedAt: undefined };
	return writeJob(agentDir, refreshed) as TmuxJobV2;
}

/** Reconcile durable completion markers. Legacy v1 records settle but never notify an unrelated Pi session. */
export async function reconcileJobs(_exec: TmuxExec, agentDir: string, owner?: TmuxOwnerContext): Promise<TmuxEvent[]> {
	const events: TmuxEvent[] = [];
	for (const original of listJobs(agentDir)) {
		let job: TmuxJob = original.version === 2 ? refreshJobActivity(agentDir, original) : original;
		if (job.state === "running" || job.state === "muted") {
			const exitCode = readPrivateInteger(signalPath(agentDir, job.id));
			const logDone = privateMarkerExists(logDonePath(agentDir, job.id));
			const logFailure = readPrivateText(logFailedPath(agentDir, job.id));
			const logFallback = privateMarkerExists(logFallbackPath(agentDir, job.id));
			if (exitCode !== undefined && (job.version === 1 || !job.logReady || logDone || logFailure !== undefined || logFallback)) {
				if (job.version === 2) {
					const observedAt = Date.now();
					job = {
						...job,
						state: exitCode === 0 ? "completed" : "failed",
						exitCode,
						logError: !job.logReady ? job.logError : logFailure !== undefined ? `tmux logger failed: ${logFailure}` : !logDone && logFallback ? "tmux logger did not publish its close marker before the fallback deadline" : job.logError,
						completion: { eventId: `tmux-job:${job.id}:completion`, observedAt, acknowledgedAt: job.muted ? observedAt : undefined },
					};
					job = writeJob(agentDir, job);
				} else {
					job = { ...job, state: exitCode === 0 ? "completed" : "failed", exitCode };
					job = writeJob(agentDir, job);
					try { unlinkSync(signalPath(agentDir, job.id)); } catch { /* legacy completion state is persisted */ }
				}
			}
		}
		if (job.version === 2 && job.completion && !job.completion.acknowledgedAt && !job.muted && owner && ownerMatches(job, owner)) {
			events.push({ job, eventId: job.completion.eventId, kind: job.state === "completed" ? "completed" : "failed", output: readBoundedLog(agentDir, job.id), logPath: logPath(agentDir, job.id) });
		}
	}
	return events;
}

const deliveryDatabases = new Map<string, DatabaseSync>();
function deliveryDatabase(agentDir: string): DatabaseSync {
	const key = resolve(tmuxDirectory(agentDir));
	const existing = deliveryDatabases.get(key);
	if (existing) return existing;
	const dir = ensureTmuxDirectory(agentDir);
	const path = join(dir, "delivery.sqlite");
	const database = new DatabaseSync(path);
	chmodSync(path, 0o600);
	database.exec("PRAGMA busy_timeout = 2000; PRAGMA journal_mode = DELETE; CREATE TABLE IF NOT EXISTS deliveries (event_id TEXT PRIMARY KEY, job_id TEXT NOT NULL, claimant TEXT NOT NULL, pid INTEGER NOT NULL, claimed_at INTEGER NOT NULL, acknowledged_at INTEGER)");
	deliveryDatabases.set(key, database);
	return database;
}
function pidAlive(pid: number): boolean {
	if (!Number.isInteger(pid) || pid <= 0) return false;
	try { process.kill(pid, 0); return true; }
	catch (error) { return (error as NodeJS.ErrnoException).code === "EPERM"; }
}

/** Atomically claim one completion across concurrently resumed Pi processes. */
export function claimJobEvent(agentDir: string, id: string, eventId: string, claimant: string): boolean {
	const database = deliveryDatabase(agentDir);
	database.exec("BEGIN IMMEDIATE");
	try {
		const row = database.prepare("SELECT claimant, pid, acknowledged_at FROM deliveries WHERE event_id = ?").get(eventId) as { claimant?: string; pid?: number; acknowledged_at?: number | null } | undefined;
		if (!row) {
			database.prepare("INSERT INTO deliveries (event_id, job_id, claimant, pid, claimed_at) VALUES (?, ?, ?, ?, ?)").run(eventId, id, claimant, process.pid, Date.now());
			database.exec("COMMIT");
			return true;
		}
		if (row.acknowledged_at !== null && row.acknowledged_at !== undefined) { database.exec("COMMIT"); return false; }
		if (row.claimant === claimant) { database.exec("COMMIT"); return true; }
		if (!pidAlive(Number(row.pid))) {
			const result = database.prepare("UPDATE deliveries SET job_id = ?, claimant = ?, pid = ?, claimed_at = ? WHERE event_id = ? AND claimant = ? AND acknowledged_at IS NULL").run(id, claimant, process.pid, Date.now(), eventId, row.claimant);
			database.exec("COMMIT");
			return Number(result.changes) === 1;
		}
		database.exec("COMMIT");
		return false;
	} catch (error) {
		try { database.exec("ROLLBACK"); } catch { /* transaction already ended */ }
		throw error;
	}
}

export function acknowledgeJobEvent(agentDir: string, id: string, eventId: string, claimant: string): boolean {
	const database = deliveryDatabase(agentDir);
	const acknowledgedAt = Date.now();
	const result = database.prepare("UPDATE deliveries SET acknowledged_at = ? WHERE event_id = ? AND job_id = ? AND claimant = ? AND acknowledged_at IS NULL").run(acknowledgedAt, eventId, id, claimant);
	if (Number(result.changes) !== 1) return false;
	const job = readJob(agentDir, id);
	if (job?.version === 2 && job.completion?.eventId === eventId && !job.completion.acknowledgedAt) writeJob(agentDir, { ...job, completion: { ...job.completion, acknowledgedAt } });
	return true;
}

export function releaseJobEventClaims(agentDir: string, claimant: string): void {
	try { deliveryDatabase(agentDir).prepare("DELETE FROM deliveries WHERE claimant = ? AND acknowledged_at IS NULL").run(claimant); } catch { /* durable job records remain pending */ }
}

export interface SilenceHandle { cancel(): void; }
/** One inactivity deadline that re-arms from durable log mtime; no pane polling. */
export function scheduleSilence(agentDir: string, id: string, notify: (job: TmuxJobV2) => void): SilenceHandle | undefined {
	const initial = readJob(agentDir, id);
	if (!initial || initial.version !== 2 || !initial.silenceSeconds || initial.muted || initial.state !== "running") return undefined;
	let canceled = false;
	let timer: ReturnType<typeof setTimeout> | undefined;
	const arm = () => {
		if (canceled) return;
		const currentValue = readJob(agentDir, id);
		if (!currentValue || currentValue.version !== 2 || !currentValue.silenceSeconds || currentValue.muted || currentValue.state !== "running") return;
		const current = refreshJobActivity(agentDir, currentValue);
		if (current.silenceNotifiedAt) return;
		const activityAt = current.lastOutputAt || current.createdAt;
		const wait = Math.max(0, activityAt + current.silenceSeconds * 1_000 - Date.now());
		timer = setTimeout(() => {
			const latestValue = readJob(agentDir, id);
			if (!latestValue || latestValue.version !== 2 || latestValue.muted || latestValue.state !== "running") return;
			const latest = refreshJobActivity(agentDir, latestValue);
			if (latest.lastOutputAt > activityAt) { arm(); return; }
			const silent = { ...latest, silenceNotifiedAt: Date.now() };
			const persisted = writeJob(agentDir, silent) as TmuxJobV2;
			if (!persisted.muted && persisted.state === "running" && persisted.silenceNotifiedAt) notify(persisted);
		}, wait);
	};
	arm();
	return { cancel() { canceled = true; if (timer) clearTimeout(timer); } };
}

export function watchJobDirectory(agentDir: string, onChange: () => void, onError: (error: Error) => void): FSWatcher {
	const watcher = watch(ensureTmuxDirectory(agentDir), { persistent: false }, () => onChange());
	watcher.on("error", (error) => onError(error));
	return watcher;
}

export async function attachInGhostty(exec: (command: string, args: string[], timeout?: number) => Promise<TmuxExecResult>, target: TmuxTarget): Promise<void> {
	const result = process.platform === "darwin"
		? await exec("open", ["-na", "Ghostty", "--args", "-e", "tmux", "-S", target.socket, "attach-session", "-t", target.session], 5_000)
		: await exec("ghostty", ["-e", "tmux", "-S", target.socket, "attach-session", "-t", target.session], 5_000);
	if (result.code !== 0) throw new Error(result.stderr.trim() || "Could not open Ghostty.");
}

function removeUnlaunchedJobFiles(agentDir: string, id: string): void {
	try {
		for (const name of readdirSync(tmuxDirectory(agentDir))) if (name.startsWith(`${id}.`)) try { unlinkSync(join(tmuxDirectory(agentDir), name)); } catch { /* absent */ }
	} catch { /* directory absent */ }
}

function sanitizeTerminalOutput(output: string): string {
	return stripVTControlCharacters(output).replace(/\r/g, "").replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, "");
}
function readBoundedLog(agentDir: string, id: string): string {
	const path = logPath(agentDir, id);
	if (!isPrivatePath(agentDir, path)) return "";
	let fd: number | undefined;
	try {
		const stat = lstatSync(path);
		if (!stat.isFile() || (stat.mode & 0o077) !== 0) return "";
		const readCap = 256 * 1024;
		const length = Math.min(stat.size, readCap);
		const buffer = Buffer.alloc(length);
		fd = openSync(path, "r");
		const readBytes = readSync(fd, buffer, 0, length, Math.max(0, stat.size - length));
		return boundOutput(sanitizeTerminalOutput(buffer.subarray(0, readBytes).toString("utf8")), stat.size > length || privateMarkerExists(logTruncatedPath(agentDir, id)));
	} catch { return ""; }
	finally { if (fd !== undefined) try { closeSync(fd); } catch { /* best effort */ } }
}
function utf8Tail(value: string, cap: number): string {
	const bytes = Buffer.from(value, "utf8");
	if (bytes.length <= cap) return value;
	let text = bytes.subarray(bytes.length - cap).toString("utf8");
	while (Buffer.byteLength(text, "utf8") > cap) text = text.slice(1);
	return text;
}
export function boundOutput(output: string, alreadyTruncated = false): string {
	const marker = "\n\n[Output truncated to the last 2000 lines / 50KB.]";
	let lines = output.split("\n");
	let truncated = alreadyTruncated || lines.length > MAX_OUTPUT_LINES;
	if (lines.length > MAX_OUTPUT_LINES) lines = lines.slice(-MAX_OUTPUT_LINES);
	let text = lines.join("\n");
	const markerBytes = truncated ? Buffer.byteLength(marker, "utf8") : 0;
	if (Buffer.byteLength(text, "utf8") + markerBytes > MAX_OUTPUT_BYTES) truncated = true;
	if (truncated) text = utf8Tail(text, MAX_OUTPUT_BYTES - Buffer.byteLength(marker, "utf8"));
	return `${text}${truncated ? marker : ""}`;
}
function writePrivate(agentDir: string, id: string, suffix: string, content: string, mode = 0o600): void {
	if (!ID_PATTERN.test(id)) throw new Error("Invalid managed tmux job id.");
	const dir = ensureTmuxDirectory(agentDir);
	const path = join(dir, `${id}${suffix}`);
	writeFileSync(path, content, { encoding: "utf8", mode });
	chmodSync(path, mode);
}
function mergeJobs(current: TmuxJob | undefined, incoming: TmuxJob): TmuxJob {
	if (!current || current.version !== incoming.version || current.id !== incoming.id) return incoming;
	const currentTerminal = current.state === "completed" || current.state === "failed";
	const incomingTerminal = incoming.state === "completed" || incoming.state === "failed";
	if (current.version === 1 && incoming.version === 1) {
		return {
			...incoming,
			command: current.command,
			target: current.target,
			createdAt: current.createdAt,
			muted: current.muted || incoming.muted,
			state: currentTerminal && !incomingTerminal ? current.state : incoming.state,
			exitCode: currentTerminal && !incomingTerminal ? current.exitCode : incoming.exitCode,
		};
	}
	if (current.version !== 2 || incoming.version !== 2) return incoming;
	const incomingHasNewActivity = incoming.lastOutputAt > current.lastOutputAt;
	let completion = incoming.completion ?? current.completion;
	if (current.completion && completion && current.completion.eventId === completion.eventId && current.completion.acknowledgedAt && !completion.acknowledgedAt) completion = { ...completion, acknowledgedAt: current.completion.acknowledgedAt };
	const muted = current.muted || incoming.muted;
	if (muted && completion && !completion.acknowledgedAt) completion = { ...completion, acknowledgedAt: Date.now() };
	const mergedState = currentTerminal && !incomingTerminal ? current.state : incoming.state;
	return {
		...incoming,
		command: current.command,
		target: current.target,
		owner: current.owner,
		createdAt: current.createdAt,
		pane: incoming.pane || current.pane,
		window: incoming.window || current.window,
		muted,
		state: muted && mergedState === "running" ? "muted" : mergedState,
		exitCode: currentTerminal && !incomingTerminal ? current.exitCode : incoming.exitCode,
		lastOutputAt: Math.max(current.lastOutputAt, incoming.lastOutputAt),
		silenceNotifiedAt: incomingHasNewActivity ? incoming.silenceNotifiedAt : (incoming.silenceNotifiedAt ?? current.silenceNotifiedAt),
		logReady: current.logReady || incoming.logReady,
		logError: incoming.logError ?? current.logError,
		completion,
	};
}
function writeJob(agentDir: string, incoming: TmuxJob): TmuxJob {
	const database = deliveryDatabase(agentDir);
	database.exec("BEGIN IMMEDIATE");
	let tmp: string | undefined;
	try {
		const job = mergeJobs(readJob(agentDir, incoming.id), incoming);
		const path = jobPath(agentDir, job.id);
		const suffix = `.json.${process.pid}.${Math.random().toString(36).slice(2, 10)}.tmp`;
		tmp = join(tmuxDirectory(agentDir), `${job.id}${suffix}`);
		writePrivate(agentDir, job.id, suffix, JSON.stringify(job));
		renameSync(tmp, path);
		tmp = undefined;
		database.exec("COMMIT");
		return job;
	} catch (error) {
		try { database.exec("ROLLBACK"); } catch { /* transaction already ended */ }
		if (tmp) try { unlinkSync(tmp); } catch { /* absent */ }
		throw error;
	}
}
function readJob(agentDir: string, id: string): TmuxJob | undefined {
	if (!ID_PATTERN.test(id)) return undefined;
	const path = jobPath(agentDir, id);
	if (!isPrivatePath(agentDir, path) || !existsSync(path)) return undefined;
	try {
		const stat = lstatSync(path);
		if (!stat.isFile() || (stat.mode & 0o077) !== 0) return undefined;
		const value = JSON.parse(readFileSync(path, "utf8"));
		return isJob(value) ? value : undefined;
	} catch { return undefined; }
}
function isPrivatePath(agentDir: string, value: string): boolean { return resolve(value).startsWith(`${resolve(tmuxDirectory(agentDir))}/`); }
function isBaseJob(job: Partial<TmuxJobBase>): boolean {
	return typeof job.id === "string" && ID_PATTERN.test(job.id) && typeof job.command === "string" && typeof job.pane === "string" && typeof job.window === "string" && typeof job.createdAt === "number" && Number.isFinite(job.createdAt) && (job.silenceSeconds === undefined || Number.isInteger(job.silenceSeconds)) && (job.state === "running" || job.state === "completed" || job.state === "failed" || job.state === "muted") && typeof job.muted === "boolean" && (job.silenceNotifiedAt === undefined || Number.isFinite(job.silenceNotifiedAt)) && (job.exitCode === undefined || Number.isInteger(job.exitCode));
}
function isJob(value: unknown): value is TmuxJob {
	if (!value || typeof value !== "object") return false;
	const job = value as Partial<TmuxJob>;
	if (!isBaseJob(job as Partial<TmuxJobBase>)) return false;
	if (job.version === 1) return isLegacyTarget(job.target);
	if (job.version !== 2 || !isTarget(job.target) || !isOwner(job.owner)) return false;
	return typeof job.lastOutputAt === "number" && Number.isFinite(job.lastOutputAt) && typeof job.logReady === "boolean"
		&& (job.logError === undefined || typeof job.logError === "string")
		&& (job.completion === undefined || (typeof job.completion.eventId === "string" && typeof job.completion.observedAt === "number" && (job.completion.acknowledgedAt === undefined || typeof job.completion.acknowledgedAt === "number")));
}
function isLegacyTarget(value: unknown): value is Omit<TmuxTarget, "socket"> { return !!value && typeof value === "object" && typeof (value as TmuxTarget).session === "string" && typeof (value as TmuxTarget).window === "string" && typeof (value as TmuxTarget).pane === "string" && typeof (value as TmuxTarget).cwd === "string"; }
function isTarget(value: unknown): value is TmuxTarget { return isLegacyTarget(value) && typeof (value as TmuxTarget).socket === "string"; }
function isOwner(value: unknown): value is TmuxJobOwner { return !!value && typeof value === "object" && typeof (value as TmuxJobOwner).piSessionId === "string" && typeof (value as TmuxJobOwner).piBranchId === "string" && typeof (value as TmuxJobOwner).tmuxSocket === "string" && typeof (value as TmuxJobOwner).tmuxSession === "string"; }
