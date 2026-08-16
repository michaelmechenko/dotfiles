import { getAgentDir, SessionManager, type ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { StringEnum } from "@earendil-works/pi-ai";
import { Type } from "typebox";
import { forkSessionAtCurrentPoint, launchForkPane } from "./fork.ts";
import { attachInGhostty, createJob, launchJob, listJobs, muteJob, peekJob, reconcileJobs, resolveTmuxTarget, scheduleSilence, type TmuxExec } from "./runtime.ts";

const Action = StringEnum(["run", "attach", "peek", "list", "mute"] as const);
const Params = Type.Object({
	action: Action,
	command: Type.Optional(Type.String({ minLength: 1, description: "Shell command for run only." })),
	destination: Type.Optional(StringEnum(["pane", "window"] as const)),
	jobId: Type.Optional(Type.String({ minLength: 1 })),
	silenceSeconds: Type.Optional(Type.Integer({ minimum: 10, maximum: 3_600 })),
});

export default function tmuxExtension(pi: ExtensionAPI): void {
	const agentDir = getAgentDir();
	const exec: TmuxExec = async (args, timeout) => pi.exec("tmux", args, { timeout });
	const systemExec = (command: string, args: string[], timeout?: number) => pi.exec(command, args, { timeout });
	const target = () => resolveTmuxTarget(exec);
	const silenceTimers = new Map<string, ReturnType<typeof setTimeout>>();
	function schedule(ctx: { ui: { notify(message: string, level: "info" | "warning" | "error"): void } }, id: string): void {
		const timer = scheduleSilence(agentDir, id, (job) => ctx.ui.notify(`tmux job ${job.id} has been silent for ${job.silenceSeconds}s.`, "warning"));
		if (timer) silenceTimers.set(id, timer);
	}
	async function reconcile(ctx: { ui: { notify(message: string, level: "info" | "warning" | "error"): void } }): Promise<void> {
		if (!agentDir) return;
		for (const event of await reconcileJobs(exec, agentDir)) ctx.ui.notify(`tmux job ${event.job.id} ${event.kind}${event.job.exitCode === undefined ? "" : ` (exit ${event.job.exitCode})`}.`, event.kind === "completed" ? "info" : "warning");
	}
	pi.registerTool({
		name: "tmux",
		label: "Tmux",
		description: "Safely manage extension-owned tmux jobs in the active tmux session. Actions: run, attach, peek, list, mute. Output is capped at 2000 lines / 50KB. It never deletes tmux sessions, windows, or panes.",
		promptSnippet: "Run, inspect, attach to, list, or mute extension-owned tmux jobs",
		promptGuidelines: ["Use tmux only for active-session work that benefits from a detached managed job. tmux cannot terminate sessions, windows, panes, or released plan workers."],
		parameters: Params,
		async execute(_id, params, _signal, _update, ctx) {
			await reconcile(ctx);
			if (params.action === "list") {
				const jobs = listJobs(agentDir);
				return { content: [{ type: "text", text: jobs.length ? jobs.map((job) => `${job.id}\t${job.state}\t${job.window}\t${job.command.split("\n")[0]}`).join("\n") : "No managed tmux jobs." }], details: { jobs } };
			}
			if (params.action === "mute") {
				if (!params.jobId) throw new Error("mute requires jobId.");
				const job = muteJob(agentDir, params.jobId); if (!job) throw new Error("Unknown managed tmux job.");
				return { content: [{ type: "text", text: `Muted tmux job ${job.id}.` }], details: { job } };
			}
			if (params.action === "peek") {
				if (!params.jobId) throw new Error("peek requires jobId.");
				const peek = await peekJob(exec, agentDir, params.jobId); return { content: [{ type: "text", text: peek.output || "(No pane output.)" }], details: peek };
			}
			const resolved = await target(); if (!resolved) throw new Error("tmux requires an active TMUX_PANE.");
			if (params.action === "attach") { await attachInGhostty(systemExec, resolved); return { content: [{ type: "text", text: `Opened Ghostty attached to tmux session ${resolved.session}.` }], details: { session: resolved.session } }; }
			if (!params.command) throw new Error("run requires command.");
			const job = await launchJob(exec, agentDir, createJob(agentDir, params.command, resolved, params.silenceSeconds), params.destination ?? "window");
			schedule(ctx, job.id);
			return { content: [{ type: "text", text: `Started tmux job ${job.id} in ${job.window}/${job.pane}.` }], details: { job } };
		},
	});
	pi.registerCommand("tmux:fork", { description: "Duplicate the current session into a new tmux pane", handler: async (_args, ctx) => {
		await ctx.waitForIdle();
		const resolved = await target(); if (!resolved) return ctx.ui.notify("/tmux:fork requires an active TMUX_PANE.", "warning");
		const sessionFile = ctx.sessionManager.getSessionFile(); const leafId = ctx.sessionManager.getLeafId();
		if (!sessionFile || !leafId) return ctx.ui.notify("The current session has not been saved yet.", "warning");
		try {
			const forkPath = forkSessionAtCurrentPoint((path, sessionDir) => SessionManager.open(path, sessionDir), sessionFile, leafId);
			const launched = await launchForkPane(exec, resolved, forkPath);
			ctx.ui.notify(`Forked the current session into pane ${launched.pane}.`, "info");
		} catch (error) { ctx.ui.notify(error instanceof Error ? error.message : "Could not fork the session.", "warning"); }
	} });
	pi.registerCommand("tmux", { description: "Open a new Ghostty client attached to the active tmux session", handler: async (_args, ctx) => { const resolved = await target(); if (!resolved) return ctx.ui.notify("tmux requires an active TMUX_PANE.", "warning"); await attachInGhostty(systemExec, resolved); } });
	pi.registerCommand("tmux:cat", { description: "Insert managed tmux job output into the editor", handler: async (args, ctx) => { const id = args.trim(); if (!id) return ctx.ui.notify("Usage: /tmux:cat <jobId>", "warning"); try { ctx.ui.pasteToEditor((await peekJob(exec, agentDir, id)).output); } catch (error) { ctx.ui.notify(error instanceof Error ? error.message : "Could not capture tmux job.", "warning"); } } });
	pi.on("session_start", async (_event, ctx) => { await reconcile(ctx); for (const job of listJobs(agentDir)) schedule(ctx, job.id); });
	pi.on("session_shutdown", async () => { for (const timer of silenceTimers.values()) clearTimeout(timer); silenceTimers.clear(); });
}
