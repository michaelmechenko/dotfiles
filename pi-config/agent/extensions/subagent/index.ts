import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import type { AgentToolResult, ThinkingLevel } from "@earendil-works/pi-agent-core";
import type { Message } from "@earendil-works/pi-ai";
import { StringEnum } from "@earendil-works/pi-ai";
import { CONFIG_DIR_NAME, type ExtensionAPI, getAgentDir } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { type AgentConfig, type AgentScope, discoverAgents } from "./agents.ts";
import { createRunnerState, reduceEvent, runSpawnedJsonl, truncateUtf8, type RunnerState, type UsageStats } from "./runner.ts";

const MAX_PARALLEL_TASKS = 8;
const MAX_CONCURRENCY = 4;
const PER_TASK_OUTPUT_CAP = 50 * 1024;
const PROGRESS_INTERVAL_MS = 150;

interface SingleResult {
	agent: string;
	agentSource: "user" | "project" | "unknown";
	task: string;
	exitCode: number;
	messages: Message[];
	stderr: string;
	usage: UsageStats;
	model?: string;
	stopReason?: string;
	errorMessage?: string;
	step?: number;
	state: RunnerState["state"];
	activeTool?: string;
	activity: string[];
	startedAt: number;
}

interface SubagentDetails {
	mode: "single" | "parallel" | "chain";
	agentScope: AgentScope;
	projectAgentsDir: string | null;
	results: SingleResult[];
}

function aggregateUsage(results: SingleResult[]) {
	const total = results.reduce((sum, result) => ({
		input: sum.input + result.usage.input,
		output: sum.output + result.usage.output,
		cacheRead: sum.cacheRead + result.usage.cacheRead,
		cacheWrite: sum.cacheWrite + result.usage.cacheWrite,
		cost: sum.cost + result.usage.cost,
	}), { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cost: 0 });
	return { ...total, totalTokens: total.input + total.output + total.cacheRead + total.cacheWrite, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: total.cost } };
}

type OnUpdateCallback = (partial: AgentToolResult<SubagentDetails>) => void;
interface DispatchDefaults { model?: string; thinkingLevel?: ThinkingLevel }

function getFinalOutput(messages: Message[]): string {
	for (let i = messages.length - 1; i >= 0; i--) {
		const msg = messages[i];
		if (msg.role !== "assistant") continue;
		for (const part of msg.content) if (part.type === "text") return part.text;
	}
	return "";
}

function isFailedResult(result: SingleResult): boolean {
	return result.exitCode !== 0 || result.state === "failed" || result.state === "aborted" || result.state === "timed_out" || result.stopReason === "error" || result.stopReason === "aborted";
}

function getResultOutput(result: SingleResult): string {
	return isFailedResult(result) ? result.errorMessage || result.stderr || getFinalOutput(result.messages) || "(no output)" : getFinalOutput(result.messages) || "(no output)";
}

function truncateOutput(output: string): string {
	if (Buffer.byteLength(output, "utf8") <= PER_TASK_OUTPUT_CAP) return output;
	return `${truncateUtf8(output, PER_TASK_OUTPUT_CAP)}\n\n[Output truncated. Full output remains in tool details.]`;
}

function formatElapsed(startedAt: number): string { return `${Math.max(0, Math.floor((Date.now() - startedAt) / 1000))}s`; }
function formatProgress(result: SingleResult, prefix = ""): string {
	const tool = result.activeTool ? ` · ${result.activeTool}` : "";
	const retry = result.state === "retrying" ? " · retrying" : "";
	const turns = result.usage.turns ? ` · ${result.usage.turns} turn${result.usage.turns === 1 ? "" : "s"}` : "";
	const tokens = result.usage.input || result.usage.output ? ` · ↑${result.usage.input} ↓${result.usage.output}` : "";
	const activity = result.activity.at(-1) ? `\n  ${result.activity.at(-1)}` : "";
	return `${prefix}${result.agent}: ${result.state}${tool}${retry}${turns}${tokens} · ${formatElapsed(result.startedAt)}${activity}`;
}

async function mapWithConcurrencyLimit<TIn, TOut>(items: TIn[], concurrency: number, fn: (item: TIn, index: number) => Promise<TOut>): Promise<TOut[]> {
	const results = new Array<TOut>(items.length);
	let next = 0;
	await Promise.all(new Array(Math.min(Math.max(1, concurrency), items.length)).fill(null).map(async () => {
		while (next < items.length) { const index = next++; results[index] = await fn(items[index], index); }
	}));
	return results;
}

async function writePrivateTaskFiles(agentName: string, task: string, systemPrompt: string): Promise<{ dir: string; taskPath: string; promptPath?: string }> {
	const dir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "pi-subagent-"));
	try {
		await fs.promises.chmod(dir, 0o700);
		const safe = agentName.replace(/[^\w.-]+/g, "_");
		const taskPath = path.join(dir, `task-${safe}.md`);
		await fs.promises.writeFile(taskPath, task, { encoding: "utf8", mode: 0o600 });
		let promptPath: string | undefined;
		if (systemPrompt.trim()) {
			promptPath = path.join(dir, `system-${safe}.md`);
			await fs.promises.writeFile(promptPath, systemPrompt, { encoding: "utf8", mode: 0o600 });
		}
		return { dir, taskPath, promptPath };
	} catch (error) {
		await fs.promises.rm(dir, { recursive: true, force: true });
		throw error;
	}
}

function getPiInvocation(args: string[]) {
	const currentScript = process.argv[1];
	if (currentScript && !currentScript.startsWith("/$bunfs/root/") && fs.existsSync(currentScript)) return { command: process.execPath, args: [currentScript, ...args] };
	return /^(node|bun)(\.exe)?$/i.test(path.basename(process.execPath)) ? { command: "pi", args } : { command: process.execPath, args };
}

function stateResult(agent: AgentConfig | undefined, agentName: string, task: string, step: number | undefined, state: RunnerState, exitCode = -1, stderr = ""): SingleResult {
	return { agent: agentName, agentSource: agent?.source ?? "unknown", task, exitCode, messages: state.messages as Message[], stderr, usage: state.usage, model: state.model, stopReason: state.stopReason, errorMessage: state.errorMessage, step, state: state.state, activeTool: state.activeTool, activity: [...state.activity], startedAt: state.startedAt };
}

async function runSingleAgent(defaultCwd: string, defaults: DispatchDefaults, agents: AgentConfig[], agentName: string, task: string, cwd: string | undefined, step: number | undefined, signal: AbortSignal | undefined, onUpdate: OnUpdateCallback | undefined, makeDetails: (results: SingleResult[]) => SubagentDetails): Promise<SingleResult> {
	const agent = agents.find((candidate) => candidate.name === agentName);
	if (!agent) {
		const available = agents.map((candidate) => `"${candidate.name}"`).join(", ") || "none";
		const state = createRunnerState(); state.state = "failed"; state.errorMessage = `Unknown agent: "${agentName}". Available agents: ${available}.`;
		return stateResult(undefined, agentName, task, step, state, 1, state.errorMessage);
	}
	const inheritsParent = !agent.model;
	const model = agent.model ?? defaults.model;
	const state = createRunnerState(model);
	let files: Awaited<ReturnType<typeof writePrivateTaskFiles>> | undefined;
	let lastUpdate = 0;
	let lastContent = "";
	const emit = (force = false) => {
		const result = stateResult(agent, agentName, task, step, state);
		const content = formatProgress(result);
		const now = Date.now();
		if (!onUpdate || (!force && (content === lastContent || now - lastUpdate < PROGRESS_INTERVAL_MS))) return;
		lastUpdate = now; lastContent = content;
		onUpdate({ content: [{ type: "text", text: content }], details: makeDetails([result]) });
	};
	try {
		files = await writePrivateTaskFiles(agent.name, task, agent.systemPrompt);
		const args = ["--mode", "json", "-p", "--no-session"];
		if (model) args.push("--model", model);
		if (inheritsParent && defaults.thinkingLevel) args.push("--thinking", defaults.thinkingLevel);
		if (agent.tools?.length) args.push("--tools", agent.tools.join(","));
		if (files.promptPath) args.push("--append-system-prompt", files.promptPath);
		args.push("Read the attached private task file and complete it.", `@${files.taskPath}`);
		const invocation = getPiInvocation(args);
		emit(true);
		const spawned = await runSpawnedJsonl({ command: invocation.command, args: invocation.args, cwd: cwd ?? defaultCwd, signal, onEvent(event) { if (reduceEvent(state, event)) emit(); } });
		if (spawned.reason === "aborted") { state.state = "aborted"; state.errorMessage = "Subagent was aborted."; }
		if (spawned.reason === "timed_out") { state.state = "timed_out"; state.errorMessage = "Subagent timed out after 30 minutes."; }
		if (spawned.spawnError) { state.state = "failed"; state.errorMessage = `Could not start subagent: ${spawned.spawnError}`; }
		if (spawned.exitCode !== 0 && (state.state === "starting" || state.state === "running")) state.state = "failed";
		if (spawned.exitCode === 0 && state.state === "starting") state.state = "completed";
		const result = stateResult(agent, agentName, task, step, state, spawned.exitCode, spawned.stderr);
		emit(true);
		return result;
	} finally {
		if (files) await fs.promises.rm(files.dir, { recursive: true, force: true });
	}
}

const TaskItem = Type.Object({ agent: Type.String({ description: "Name of the agent to invoke" }), task: Type.String({ description: "Task to delegate to the agent" }), cwd: Type.Optional(Type.String({ description: "Working directory for the agent process" })) });
const ChainItem = Type.Object({ agent: Type.String({ description: "Name of the agent to invoke" }), task: Type.String({ description: "Task with optional {previous} placeholder for prior output" }), cwd: Type.Optional(Type.String({ description: "Working directory for the agent process" })) });
const AgentScopeSchema = StringEnum(["user", "project", "both"] as const, { description: 'Which agent directories to use. Default: "user". Use "both" to include project-local agents.', default: "user" });
const SubagentParams = Type.Object({ agent: Type.Optional(Type.String({ description: "Name of the agent to invoke (for single mode)" })), task: Type.Optional(Type.String({ description: "Task to delegate (for single mode)" })), tasks: Type.Optional(Type.Array(TaskItem, { description: "Array of {agent, task} for parallel execution" })), chain: Type.Optional(Type.Array(ChainItem, { description: "Array of {agent, task} for sequential execution" })), agentScope: Type.Optional(AgentScopeSchema), confirmProjectAgents: Type.Optional(Type.Boolean({ description: "Prompt before running project-local agents. Default: true.", default: true })), cwd: Type.Optional(Type.String({ description: "Working directory for the agent process (single mode)" })) });

export default function(pi: ExtensionAPI) {
	// AgentToolResult has no isError field. Patch the completed tool result through
	// Pi's supported event seam while retaining structured details and usage.
	pi.on("tool_result", async (event) => {
		if (event.toolName !== "subagent") return undefined;
		const details = event.details as SubagentDetails | undefined;
		return { isError: Boolean(details?.results.some(isFailedResult)) };
	});
	pi.registerTool({
		name: "subagent", label: "Subagent", renderShell: "default", executionMode: "parallel",
		description: "Delegate a bounded foreground task to a specialized, isolated subagent. Use researcher for deep primary-source research, scout for fast codebase recon, reviewer for adversarial review, and worker only for bounded implementation work.",
		promptSnippet: "Delegate bounded, context-heavy research, recon, or review to an isolated specialist.",
		promptGuidelines: ["Delegate deep primary-source research to researcher with a compact task contract; it writes the detailed cited brief to a file and returns a concise handoff.", "Use fresh isolated context for research and review; retain parent authority and do not delegate trivial work or concurrent writes to the same checkout."],
		parameters: SubagentParams,
		async execute(_id, params, signal, onUpdate, ctx) {
			const agentScope: AgentScope = params.agentScope ?? "user";
			const discovery = discoverAgents(ctx.cwd, agentScope);
			const defaults: DispatchDefaults = { model: ctx.model ? `${ctx.model.provider}/${ctx.model.id}` : undefined, thinkingLevel: ctx.thinkingLevel };
			const makeDetails = (mode: SubagentDetails["mode"]) => (results: SingleResult[]): SubagentDetails => ({ mode, agentScope, projectAgentsDir: discovery.projectAgentsDir, results });
			const mode = params.chain?.length ? "chain" : params.tasks?.length ? "parallel" : params.agent && params.task ? "single" : undefined;
			if (!mode) throw new Error("Invalid parameters. Provide exactly one of single, tasks, or chain.");
			if ((params.confirmProjectAgents ?? true) && (agentScope === "project" || agentScope === "both") && ctx.hasUI) {
				const names = (params.chain ?? params.tasks ?? (params.agent ? [{ agent: params.agent }] : [])).map((item) => item.agent);
				const project = names.map((name) => discovery.agents.find((item) => item.name === name)).filter((item): item is AgentConfig => item?.source === "project");
				if (project.length && !(await ctx.ui.confirm("Run project-local agents?", `Agents: ${project.map((item) => item.name).join(", ")}\nSource: ${discovery.projectAgentsDir}\n\nProject agents are repo-controlled.`))) return { content: [{ type: "text", text: "Canceled: project-local agents not approved." }], details: makeDetails(mode)([]) };
			}
			if (mode === "single") {
				const result = await runSingleAgent(ctx.cwd, defaults, discovery.agents, params.agent!, params.task!, params.cwd, undefined, signal, onUpdate, makeDetails("single"));
				return { content: [{ type: "text", text: isFailedResult(result) ? `Agent failed: ${getResultOutput(result)}` : getFinalOutput(result.messages) || "(no output)" }], details: makeDetails("single")([result]), usage: aggregateUsage([result]) };
			}
			if (mode === "chain") {
				const results: SingleResult[] = []; let previous = "";
				for (let index = 0; index < params.chain!.length; index++) {
					const item = params.chain![index];
					const result = await runSingleAgent(ctx.cwd, defaults, discovery.agents, item.agent, item.task.replace(/\{previous\}/g, previous), item.cwd, index + 1, signal, (partial) => { const current = partial.details?.results[0]; if (current) onUpdate?.({ content: [{ type: "text", text: formatProgress(current, `Step ${index + 1}/${params.chain!.length} · `) }], details: makeDetails("chain")([...results, current]) }); }, makeDetails("chain"));
					results.push(result); if (isFailedResult(result)) return { content: [{ type: "text", text: `Chain stopped at step ${index + 1} (${item.agent}): ${getResultOutput(result)}` }], details: makeDetails("chain")(results), usage: aggregateUsage(results) }; previous = getFinalOutput(result.messages);
				}
				return { content: [{ type: "text", text: getFinalOutput(results.at(-1)!.messages) || "(no output)" }], details: makeDetails("chain")(results), usage: aggregateUsage(results) };
			}
			if (params.tasks!.length > MAX_PARALLEL_TASKS) throw new Error(`Too many parallel tasks (${params.tasks!.length}). Max is ${MAX_PARALLEL_TASKS}.`);
			const all: SingleResult[] = params.tasks!.map((item) => stateResult(undefined, item.agent, item.task, undefined, createRunnerState(), -1));
			const emitParallel = () => onUpdate?.({ content: [{ type: "text", text: all.map((result, index) => formatProgress(result, `Lane ${index + 1}/${all.length} · `)).join("\n") }], details: makeDetails("parallel")([...all]) });
			const results = await mapWithConcurrencyLimit(params.tasks!, MAX_CONCURRENCY, async (item, index) => { const result = await runSingleAgent(ctx.cwd, defaults, discovery.agents, item.agent, item.task, item.cwd, undefined, signal, (partial) => { if (partial.details?.results[0]) { all[index] = partial.details.results[0]; emitParallel(); } }, makeDetails("parallel")); all[index] = result; emitParallel(); return result; });
			const summaries = results.map((result) => `### [${result.agent}] ${isFailedResult(result) ? "failed" : "completed"}\n\n${truncateOutput(getResultOutput(result))}`);
			return { content: [{ type: "text", text: `Parallel: ${results.filter((result) => !isFailedResult(result)).length}/${results.length} succeeded\n\n${summaries.join("\n\n---\n\n")}` }], details: makeDetails("parallel")(results), usage: aggregateUsage(results) };
		},
	});
}
