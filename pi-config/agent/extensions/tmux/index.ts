import { getAgentDir, SessionManager, type ExtensionAPI, type ExtensionContext } from "@earendil-works/pi-coding-agent";
import { StringEnum } from "@earendil-works/pi-ai";
import { Type } from "typebox";
import { forkSessionAtCurrentPoint, launchForkPane } from "./fork.ts";
import {
	acknowledgeJobEvent,
	attachInGhostty,
	claimJobEvent,
	boundOutput,
	createJob,
	getJob,
	launchJob,
	listJobs,
	muteJob,
	ownerMatches,
	peekJob,
	reconcileJobs,
	releaseJobEventClaims,
	retainedLogPath,
	resolveTmuxTarget,
	scheduleSilence,
	watchJobDirectory,
	type SilenceHandle,
	type TmuxExec,
	type TmuxJob,
	type TmuxJobOwner,
	type TmuxOwnerContext,
	type TmuxPaneDirection,
	type TmuxTarget,
} from "./runtime.ts";

const Action = StringEnum(["run", "attach", "peek", "list", "mute"] as const);
const Params = Type.Object({
	action: Action,
	command: Type.Optional(Type.String({ minLength: 1, description: "Shell command for run only." })),
	destination: Type.Optional(StringEnum(["pane", "window"] as const)),
	jobId: Type.Optional(Type.String({ minLength: 1 })),
	silenceSeconds: Type.Optional(Type.Integer({ minimum: 10, maximum: 3_600 })),
});

function branchIds(ctx: ExtensionContext): string[] {
	return ctx.sessionManager.getBranch().flatMap((entry) => typeof (entry as { id?: unknown }).id === "string" ? [(entry as { id: string }).id] : []);
}
function ownerForLaunch(ctx: ExtensionContext, target: TmuxTarget): TmuxJobOwner {
	const piSessionId = ctx.sessionManager.getSessionId();
	const piBranchId = ctx.sessionManager.getLeafId();
	if (!piSessionId || !piBranchId) throw new Error("The current Pi session branch has not been saved yet.");
	return { piSessionId, piBranchId, tmuxSocket: target.socket, tmuxSession: target.session };
}
function ownerContext(ctx: ExtensionContext, target: TmuxTarget): TmuxOwnerContext | undefined {
	const piSessionId = ctx.sessionManager.getSessionId();
	if (!piSessionId) return undefined;
	return { piSessionId, tmuxSocket: target.socket, tmuxSession: target.session, branchIds: branchIds(ctx) };
}
const MAX_TOOL_OUTPUT_BYTES = 50 * 1024;
function truncateUtf8(value: string, cap: number): string {
	if (Buffer.byteLength(value, "utf8") <= cap) return value;
	let clipped = value.slice(0, cap);
	while (Buffer.byteLength(clipped, "utf8") > cap) clipped = clipped.slice(0, -1);
	return clipped;
}
function firstLine(value: string, cap = 240): string {
	const line = value.split("\n", 1)[0] || "";
	return line.length > cap ? `${line.slice(0, cap - 1)}…` : line;
}
function withSuffix(output: string, suffix: string): string {
	return `${truncateUtf8(output, Math.max(0, MAX_TOOL_OUTPUT_BYTES - Buffer.byteLength(suffix, "utf8")))}${suffix}`;
}
function jobDetails(job: TmuxJob): Record<string, unknown> {
	return { version: job.version, id: job.id, state: job.state, pane: job.pane, window: job.window, createdAt: job.createdAt, exitCode: job.exitCode, muted: job.muted, command: firstLine(job.command), ...(job.version === 2 ? { owner: job.owner, lastOutputAt: job.lastOutputAt, silenceSeconds: job.silenceSeconds, silenceNotifiedAt: job.silenceNotifiedAt, logReady: job.logReady, logError: job.logError ? firstLine(job.logError, 1024) : undefined, completion: job.completion } : {}) };
}
function visibleJobs(jobs: TmuxJob[], owner: TmuxOwnerContext): TmuxJob[] {
	// Legacy records remain explicitly readable, but they never produce automatic notifications.
	return jobs.filter((job) => job.version === 1 || ownerMatches(job, owner));
}

export default function tmuxExtension(pi: ExtensionAPI): void {
	const agentDir = getAgentDir();
	const exec: TmuxExec = async (args, timeout) => pi.exec("tmux", args, { timeout });
	const systemExec = (command: string, args: string[], timeout?: number) => pi.exec(command, args, { timeout });
	const target = () => resolveTmuxTarget(exec);
	const silenceTimers = new Map<string, SilenceHandle>();
	const queuedEvents = new Map<string, { jobId: string; summary: string }>();
	const injectingEvents = new Map<string, string>();
	const claimant = `${process.pid}-${Math.random().toString(36).slice(2, 12)}`;
	let watcher: ReturnType<typeof watchJobDirectory> | undefined;
	let watcherRetry: ReturnType<typeof setTimeout> | undefined;
	let scanRetry: ReturnType<typeof setTimeout> | undefined;
	let scanTimer: ReturnType<typeof setTimeout> | undefined;
	let activeContext: ExtensionContext | undefined;
	let generation = 0;
	let reconcileRunning = false;
	let reconcileRequested = false;

	function stopObservers(): void {
		generation++;
		releaseJobEventClaims(agentDir, claimant);
		queuedEvents.clear();
		injectingEvents.clear();
		watcher?.close();
		watcher = undefined;
		if (watcherRetry) clearTimeout(watcherRetry);
		watcherRetry = undefined;
		if (scanRetry) clearTimeout(scanRetry);
		scanRetry = undefined;
		if (scanTimer) clearTimeout(scanTimer);
		scanTimer = undefined;
		for (const handle of silenceTimers.values()) handle.cancel();
		silenceTimers.clear();
	}

	function scheduleSilenceFor(ctx: ExtensionContext, job: TmuxJob, owner: TmuxOwnerContext): void {
		silenceTimers.get(job.id)?.cancel();
		silenceTimers.delete(job.id);
		if (job.version !== 2 || !ownerMatches(job, owner)) return;
		const handle = scheduleSilence(agentDir, job.id, (silent) => ctx.ui.notify(`tmux job ${silent.id} has produced no output for ${silent.silenceSeconds}s.`, "warning"));
		if (handle) silenceTimers.set(job.id, handle);
	}

	async function scan(ctx: ExtensionContext, expectedGeneration = generation): Promise<void> {
		reconcileRequested = true;
		if (reconcileRunning) return;
		reconcileRunning = true;
		try {
			while (reconcileRequested && expectedGeneration === generation) {
				reconcileRequested = false;
				const resolved = await target();
				if (!resolved || expectedGeneration !== generation) return;
				const owner = ownerContext(ctx, resolved);
				if (!owner) return;
				const events = await reconcileJobs(exec, agentDir, owner);
				if (expectedGeneration !== generation) return;
				for (const job of visibleJobs(listJobs(agentDir), owner)) scheduleSilenceFor(ctx, job, owner);
				for (const event of events) {
					if (queuedEvents.has(event.eventId) || !claimJobEvent(agentDir, event.job.id, event.eventId, claimant)) continue;
					const header = `Tmux job ${event.job.id} ${event.kind}${event.job.exitCode === undefined ? "" : ` with exit ${event.job.exitCode}`}.\nCommand: ${firstLine(event.job.command)}\nRetained log: ${event.logPath}\n\n`;
					const summary = `${header}${truncateUtf8(event.output || "(No captured output.)", Math.max(0, MAX_TOOL_OUTPUT_BYTES - Buffer.byteLength(header, "utf8")))}`;
					queuedEvents.set(event.eventId, { jobId: event.job.id, summary });
					ctx.ui.notify(`tmux job ${event.job.id} ${event.kind}${event.job.exitCode === undefined ? "" : ` (exit ${event.job.exitCode})`}.`, event.kind === "completed" ? "info" : "warning");
				}
			}
		} finally {
			reconcileRunning = false;
			if (reconcileRequested && activeContext) queueScan(activeContext, generation);
		}
	}

	function startScan(ctx: ExtensionContext, expectedGeneration: number): void {
		void scan(ctx, expectedGeneration).catch((error) => {
			if (expectedGeneration !== generation) return;
			ctx.ui.notify(`tmux job reconciliation failed: ${error instanceof Error ? error.message : String(error)}. Retrying.`, "warning");
			if (scanRetry) clearTimeout(scanRetry);
			scanRetry = setTimeout(() => queueScan(ctx, expectedGeneration), 1_000);
		});
	}

	function queueScan(ctx: ExtensionContext, expectedGeneration = generation): void {
		if (scanTimer) clearTimeout(scanTimer);
		scanTimer = setTimeout(() => { scanTimer = undefined; startScan(ctx, expectedGeneration); }, 50);
	}

	function bindWatcher(ctx: ExtensionContext, expectedGeneration: number): void {
		if (expectedGeneration !== generation) return;
		watcher?.close();
		const retry = (message: string) => {
			if (expectedGeneration !== generation) return;
			ctx.ui.notify(`tmux job watcher failed: ${message}. Rebinding.`, "warning");
			startScan(ctx, expectedGeneration);
			if (watcherRetry) clearTimeout(watcherRetry);
			watcherRetry = setTimeout(() => bindWatcher(ctx, expectedGeneration), 1_000);
		};
		try {
			watcher = watchJobDirectory(agentDir, () => queueScan(ctx, expectedGeneration), (error) => {
				watcher?.close();
				watcher = undefined;
				retry(error.message);
			});
			// Close the error-scan/rebind gap by reconciling after every successful bind.
			startScan(ctx, expectedGeneration);
		} catch (error) {
			watcher = undefined;
			retry(error instanceof Error ? error.message : String(error));
		}
	}

	pi.registerTool({
		name: "tmux",
		label: "Tmux",
		description: "Safely manage extension-owned tmux jobs in the active tmux session. Actions: run, attach, peek, list, mute. Output is capped at 2000 lines / 50KB and full logs are retained privately. It never deletes tmux sessions, windows, or panes.",
		promptSnippet: "Run, inspect, attach to, list, or mute extension-owned tmux jobs",
		promptGuidelines: ["Use tmux only for active-session work that benefits from a detached managed job. Select an exact managed job before peek or mute. tmux cannot terminate sessions, windows, panes, or released plan workers."],
		parameters: Params,
		async execute(_id, params, _signal, _update, ctx) {
			const resolved = await target();
			if (!resolved) throw new Error("tmux requires an active TMUX_PANE.");
			const owner = ownerContext(ctx, resolved);
			if (!owner) throw new Error("The current Pi session has not been saved yet.");
			await scan(ctx);
			if (params.action === "list") {
				const jobs = visibleJobs(listJobs(agentDir), owner);
				const text = jobs.length ? jobs.map((job) => `${job.id}\t${job.state}\t${job.window}\t${job.version === 1 ? "legacy-unowned\t" : ""}${firstLine(job.command)}`).join("\n") : "No managed tmux jobs for this Pi session and branch.";
				return { content: [{ type: "text", text: boundOutput(text) }], details: { jobs: jobs.slice(-2_000).map(jobDetails) } };
			}
			if (params.action === "mute") {
				if (!params.jobId) throw new Error("mute requires jobId.");
				const existing = getJob(agentDir, params.jobId);
				if (!existing || (existing.version === 2 && !ownerMatches(existing, owner))) throw new Error("Unknown managed tmux job for this Pi session and branch.");
				const job = muteJob(agentDir, params.jobId, owner);
				if (!job) throw new Error("Unknown managed tmux job for this Pi session and branch.");
				for (const [eventId, queued] of [...queuedEvents]) {
					if (queued.jobId !== job.id) continue;
					acknowledgeJobEvent(agentDir, job.id, eventId, claimant);
					queuedEvents.delete(eventId);
				}
				silenceTimers.get(job.id)?.cancel(); silenceTimers.delete(job.id);
				return { content: [{ type: "text", text: `Muted tmux job ${job.id}.` }], details: { job: jobDetails(job) } };
			}
			if (params.action === "peek") {
				if (!params.jobId) throw new Error("peek requires jobId.");
				const peek = await peekJob(exec, agentDir, params.jobId, owner);
				const suffix = peek.logPath ? `\n\nFull retained log: ${peek.logPath}` : "";
				return { content: [{ type: "text", text: withSuffix(peek.output || "(No retained output.)", suffix) }], details: { job: jobDetails(peek.job), logPath: peek.logPath } };
			}
			if (params.action === "attach") {
				await attachInGhostty(systemExec, resolved);
				return { content: [{ type: "text", text: `Opened Ghostty attached to tmux session ${resolved.session}.` }], details: { session: resolved.session, socket: resolved.socket } };
			}
			if (!params.command) throw new Error("run requires command.");
			const job = await launchJob(exec, agentDir, createJob(agentDir, params.command, resolved, ownerForLaunch(ctx, resolved), params.silenceSeconds), params.destination ?? "window");
			scheduleSilenceFor(ctx, job, owner);
			return { content: [{ type: "text", text: `Started tmux job ${job.id} in ${job.window}/${job.pane}. Full retained log: ${retainedLogPath(agentDir, job.id)}${job.logError ? ` Logging warning: ${firstLine(job.logError, 1024)}` : ""}` }], details: { job: jobDetails(job), logPath: retainedLogPath(agentDir, job.id) } };
		},
	});

	pi.registerCommand("tmux:fork", { description: "Duplicate the current session into a new tmux pane: /tmux:fork [below|right]", handler: async (args, ctx) => {
		const direction: TmuxPaneDirection = args.trim() === "right" ? "right" : "below";
		if (args.trim() && args.trim() !== "below" && args.trim() !== "right") return ctx.ui.notify("Usage: /tmux:fork [below|right]", "warning");
		await ctx.waitForIdle();
		const resolved = await target(); if (!resolved) return ctx.ui.notify("/tmux:fork requires an active TMUX_PANE.", "warning");
		const sessionFile = ctx.sessionManager.getSessionFile(); const leafId = ctx.sessionManager.getLeafId();
		if (!sessionFile || !leafId) return ctx.ui.notify("The current session has not been saved yet.", "warning");
		try {
			const forkPath = forkSessionAtCurrentPoint((path, sessionDir) => SessionManager.open(path, sessionDir), sessionFile, leafId);
			const launched = await launchForkPane(exec, resolved, forkPath, direction);
			ctx.ui.notify(`Forked the current session into a ${direction} pane ${launched.pane}.`, "info");
		} catch (error) { ctx.ui.notify(error instanceof Error ? error.message : "Could not fork the session.", "warning"); }
	} });
	pi.registerCommand("tmux", { description: "Open a new Ghostty client attached to the active tmux session", handler: async (_args, ctx) => { const resolved = await target(); if (!resolved) return ctx.ui.notify("tmux requires an active TMUX_PANE.", "warning"); await attachInGhostty(systemExec, resolved); } });
	pi.registerCommand("tmux:cat", { description: "Insert managed tmux job output into the editor", handler: async (args, ctx) => {
		const id = args.trim(); if (!id) return ctx.ui.notify("Usage: /tmux:cat <jobId>", "warning");
		try {
			const resolved = await target(); if (!resolved) throw new Error("tmux requires an active TMUX_PANE.");
			const owner = ownerContext(ctx, resolved); if (!owner) throw new Error("The current Pi session has not been saved yet.");
			ctx.ui.pasteToEditor((await peekJob(exec, agentDir, id, owner)).output);
		} catch (error) { ctx.ui.notify(error instanceof Error ? error.message : "Could not read the tmux job log.", "warning"); }
	} });

	pi.on("before_agent_start", async () => {
		if (injectingEvents.size || !queuedEvents.size) return;
		const selected: Array<{ eventId: string; jobId: string; summary: string }> = [];
		let bytes = 0;
		for (const [eventId, queued] of queuedEvents) {
			const separator = selected.length ? "\n\n---\n\n" : "";
			const remaining = MAX_TOOL_OUTPUT_BYTES - bytes - Buffer.byteLength(separator, "utf8");
			if (remaining <= 0) break;
			const summary = truncateUtf8(queued.summary, remaining);
			selected.push({ eventId, jobId: queued.jobId, summary: `${separator}${summary}` });
			bytes += Buffer.byteLength(separator + summary, "utf8");
			if (Buffer.byteLength(queued.summary, "utf8") > remaining) break;
		}
		if (!selected.length) return;
		for (const item of selected) injectingEvents.set(item.eventId, item.jobId);
		return { message: { customType: "tmux-job-completion", content: selected.map((item) => item.summary).join(""), display: true } };
	});
	pi.on("agent_start", async () => {
		for (const [eventId, jobId] of [...injectingEvents]) {
			if (!acknowledgeJobEvent(agentDir, jobId, eventId, claimant)) continue;
			injectingEvents.delete(eventId);
			queuedEvents.delete(eventId);
		}
	});
	pi.on("session_start", async (_event, ctx) => {
		stopObservers();
		activeContext = ctx;
		const currentGeneration = generation;
		bindWatcher(ctx, currentGeneration);
		await scan(ctx, currentGeneration);
	});
	pi.on("session_shutdown", async () => { activeContext = undefined; stopObservers(); });
}
