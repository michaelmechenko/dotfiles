import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import type { AgentToolResult, ThinkingLevel } from "@earendil-works/pi-agent-core";
import type { Message } from "@earendil-works/pi-ai";
import { StringEnum } from "@earendil-works/pi-ai";
import { type ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { type AgentConfig, type AgentScope, discoverAgents, requireProjectApproval } from "./agents.ts";
import { MAX_CONCURRENCY, normalizeDelegationRequest, replacePreviousLiteral, resolveChildTools, SharedConcurrencyLimiter } from "./delegation.ts";
import { prepareOutputCapture, type ResultArtifact } from "./result-artifacts.ts";
import { accessModeFrom, childToolRestriction } from "./execution-policy.ts";
import type { AccessMode } from "../plan-mode/plan-state.ts";
import { createRunnerState, MAX_ERROR_BYTES, MAX_METADATA_BYTES, reduceEvent, runSpawnedJsonl, truncateUtf8, type RunnerState, type UsageStats } from "./runner.ts";
const PER_TASK_OUTPUT_CAP = 50 * 1024;
const TOTAL_PARALLEL_OUTPUT_CAP = 100 * 1024;
const PARALLEL_OUTPUT_OVERHEAD_RESERVE = 4 * 1024;
const TASK_DETAIL_CAP = 4 * 1024;
const AGENT_NAME_CAP = 128;
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
	output: string;
	outputTruncated: boolean;
	outputArtifact?: ResultArtifact;
	outputArtifactError?: string;
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
	diagnostics: string[];
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
interface DispatchDefaults { model?: string; thinkingLevel?: ThinkingLevel; accessMode: AccessMode }

function isFailedResult(result: SingleResult): boolean {
	return result.exitCode !== 0 || result.state === "failed" || result.state === "aborted" || result.state === "timed_out" || result.stopReason === "error" || result.stopReason === "aborted";
}

function getResultOutput(result: SingleResult): string {
	return isFailedResult(result) ? result.errorMessage || result.stderr || result.output || "(no output)" : result.output || "(no output)";
}

function formatResultOutput(result: SingleResult, budget = PER_TASK_OUTPUT_CAP): string {
	const output = getResultOutput(result);
	const notes: string[] = [];
	if (result.outputArtifact) notes.push(`Full output: ${result.outputArtifact.path} (${result.outputArtifact.bytes} bytes, mode 0600).`);
	else if (result.outputTruncated) notes.push(`Output truncated; retained artifact unavailable${result.outputArtifactError ? `: ${result.outputArtifactError}` : "."}`);
	const suffix = notes.length ? `\n\n[${notes.join(" ")}]` : "";
	const outputBudget = Math.max(0, budget - Buffer.byteLength(suffix, "utf8"));
	return truncateUtf8(`${truncateUtf8(output, outputBudget)}${suffix}`, budget);
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
	const taskPreview = Buffer.byteLength(task, "utf8") > TASK_DETAIL_CAP ? `${truncateUtf8(task, TASK_DETAIL_CAP)}\n[task truncated in details]` : task;
	return { agent: truncateUtf8(agentName, AGENT_NAME_CAP), agentSource: agent?.source ?? "unknown", task: taskPreview, exitCode, messages: state.messages as Message[], stderr, usage: state.usage, model: state.model ? truncateUtf8(state.model, MAX_METADATA_BYTES) : undefined, stopReason: state.stopReason ? truncateUtf8(state.stopReason, MAX_METADATA_BYTES) : undefined, errorMessage: state.errorMessage ? truncateUtf8(state.errorMessage, MAX_ERROR_BYTES) : undefined, output: state.finalOutput, outputTruncated: state.outputTruncated, outputArtifact: state.outputArtifact, outputArtifactError: state.outputArtifactError ? truncateUtf8(state.outputArtifactError, MAX_ERROR_BYTES) : undefined, step, state: state.state, activeTool: state.activeTool ? truncateUtf8(state.activeTool, MAX_METADATA_BYTES) : undefined, activity: [...state.activity], startedAt: state.startedAt };
}

async function runSingleAgent(defaultCwd: string, defaults: DispatchDefaults, agents: AgentConfig[], parentTools: string[], agentName: string, task: string, cwd: string | undefined, step: number | undefined, outputBudget: number, limiter: SharedConcurrencyLimiter, signal: AbortSignal | undefined, onUpdate: OnUpdateCallback | undefined, makeDetails: (results: SingleResult[]) => SubagentDetails): Promise<SingleResult> {
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
	let releaseSlot: (() => void) | undefined;
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
		try {
			releaseSlot = await limiter.acquire(signal);
		} catch (error) {
			state.state = signal?.aborted || (error instanceof Error && error.name === "AbortError") ? "aborted" : "failed";
			state.errorMessage = error instanceof Error ? error.message : String(error);
			return stateResult(agent, agentName, task, step, state, state.state === "aborted" ? -1 : 1, state.errorMessage);
		}
		try {
			state.captureOutput = await prepareOutputCapture(agent.name, Math.max(1, outputBudget));
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			state.captureOutput = (output) => {
				const truncated = Buffer.byteLength(output, "utf8") > outputBudget;
				return { preview: truncateUtf8(output, outputBudget), truncated, artifactError: truncated ? message : undefined };
			};
		}
		files = await writePrivateTaskFiles(agent.name, task, agent.systemPrompt);
		const args = ["--mode", "json", "-p", "--no-session"];
		if (model) args.push("--model", model);
		if (inheritsParent && defaults.thinkingLevel) args.push("--thinking", defaults.thinkingLevel);
		args.push("--tools", resolveChildTools(agent, parentTools).join(","));
		if (files.promptPath) args.push("--append-system-prompt", files.promptPath);
		args.push("Read the attached private task file and complete it.", `@${files.taskPath}`);
		const invocation = getPiInvocation(args);
		emit(true);
		const childTools = resolveChildTools(agent, parentTools);
		const { PI_PLAN_HANDOFF: _planHandoff, PI_PLAN_PROVIDER: _planProvider, PI_PLAN_MODEL: _planModel, PI_PLAN_THINKING: _planThinking, ...environment } = process.env;
		const spawned = await runSpawnedJsonl({ command: invocation.command, args: invocation.args, cwd: cwd ?? defaultCwd, env: { ...environment, PI_SUBAGENT_ACCESS_MODE: defaults.accessMode, PI_SUBAGENT_ALLOWED_TOOLS: JSON.stringify(childTools) }, signal, onEvent(event) { if (reduceEvent(state, event)) emit(); } });
		if (spawned.reason === "aborted") { state.state = "aborted"; state.errorMessage = "Subagent was aborted."; }
		if (spawned.reason === "timed_out") { state.state = "timed_out"; state.errorMessage = "Subagent timed out after 30 minutes."; }
		if (spawned.spawnError) { state.state = "failed"; state.errorMessage = `Could not start subagent: ${spawned.spawnError}`; }
		if (spawned.protocolError) { state.state = "failed"; state.errorMessage = spawned.protocolError; }
		if (spawned.exitCode !== 0 && (state.state === "starting" || state.state === "running")) state.state = "failed";
		if (spawned.exitCode === 0 && !spawned.protocolError && (state.state === "starting" || state.state === "running")) state.state = "completed";
		const result = stateResult(agent, agentName, task, step, state, spawned.exitCode, spawned.stderr);
		emit(true);
		return result;
	} finally {
		try {
			if (files) await fs.promises.rm(files.dir, { recursive: true, force: true });
		} finally {
			releaseSlot?.();
		}
	}
}

const TaskItem = Type.Object({ agent: Type.String({ description: "Name of the agent to invoke" }), task: Type.String({ description: "Task to delegate to the agent" }), cwd: Type.Optional(Type.String({ description: "Working directory for the agent process" })) });
const ChainItem = Type.Object({ agent: Type.String({ description: "Name of the agent to invoke" }), task: Type.String({ description: "Task with optional {previous} placeholder for prior output" }), cwd: Type.Optional(Type.String({ description: "Working directory for the agent process" })) });
const AgentScopeSchema = StringEnum(["user", "project", "both"] as const, { description: 'Which agent directories to use. Default: "user". Use "both" to include project-local agents.', default: "user" });
const SubagentParams = Type.Object({ agent: Type.Optional(Type.String({ description: "Name of the agent to invoke (for single mode)" })), task: Type.Optional(Type.String({ description: "Task to delegate (for single mode)" })), tasks: Type.Optional(Type.Array(TaskItem, { description: "Array of {agent, task} for parallel execution" })), chain: Type.Optional(Type.Array(ChainItem, { description: "Array of {agent, task} for sequential execution" })), agentScope: Type.Optional(AgentScopeSchema), cwd: Type.Optional(Type.String({ description: "Working directory for the agent process (single mode)" })) });

export default function(pi: ExtensionAPI) {
	const limiter = new SharedConcurrencyLimiter(MAX_CONCURRENCY);
	const childAccessMode = accessModeFrom(process.env.PI_SUBAGENT_ACCESS_MODE);
	let childAllowedTools: Set<string> | undefined;
	if (process.env.PI_SUBAGENT_ALLOWED_TOOLS !== undefined) {
		try {
			const names = JSON.parse(process.env.PI_SUBAGENT_ALLOWED_TOOLS);
			childAllowedTools = new Set(Array.isArray(names) && names.every((name) => typeof name === "string") ? names : []);
		} catch { childAllowedTools = new Set(); }
	}
	if (childAllowedTools) pi.on("before_agent_start", (event) => {
		event.systemPromptOptions.selectedTools = event.systemPromptOptions.selectedTools.filter((name) => childAllowedTools!.has(name));
	});
	if (childAllowedTools || childAccessMode !== "none") pi.on("tool_call", (event) => {
		if (childAllowedTools && !childAllowedTools.has(event.toolName)) return { block: true, reason: `Subagent parent policy disabled tool '${event.toolName}'.` };
		const reason = childToolRestriction(childAccessMode, event.toolName, event.input);
		return reason ? { block: true, reason } : undefined;
	});
	pi.on("session_shutdown", async () => { limiter.close(); });
	// AgentToolResult has no isError field. Patch the completed tool result through
	// Pi's supported event seam while retaining structured details and usage.
	pi.on("tool_result", async (event) => {
		if (event.toolName !== "subagent") return undefined;
		const details = event.details as SubagentDetails | undefined;
		return { isError: event.isError || Boolean(details?.results.some(isFailedResult)) };
	});
	pi.registerTool({
		name: "subagent", label: "Subagent", renderShell: "default", executionMode: "parallel",
		description: "Delegate a bounded foreground task to a specialized, isolated subagent. Use researcher for deep primary-source research, scout for fast codebase recon, reviewer for adversarial review, and worker only for bounded implementation work.",
		promptSnippet: "Delegate bounded, context-heavy research, recon, or review to an isolated specialist.",
		promptGuidelines: ["Delegate deep primary-source research to researcher with a compact task contract; it writes the detailed cited brief to a file and returns a concise handoff.", "Use fresh isolated context for research and review; retain parent authority and do not delegate trivial work or concurrent writes to the same checkout."],
		parameters: SubagentParams,
		async execute(_id, params, signal, onUpdate, ctx) {
			const request = normalizeDelegationRequest(params, ctx.cwd);
			const agentScope: AgentScope = params.agentScope ?? "user";
			const discovery = discoverAgents(ctx.cwd, agentScope);
			const parentTools = pi.getActiveTools();
			let accessMode: AccessMode = childAccessMode;
			pi.events.emit("plan-mode:access-policy", (mode: AccessMode) => { accessMode = mode; });
			const defaults: DispatchDefaults = { model: ctx.model ? `${ctx.model.provider}/${ctx.model.id}` : undefined, thinkingLevel: ctx.thinkingLevel, accessMode };
			if (ctx.scopedModels?.length) {
				const permitted = new Set(ctx.scopedModels.map((item) => `${item.model.provider}/${item.model.id}`));
				for (const item of request.items) {
					const agentModel = discovery.agents.find((candidate) => candidate.name === item.agent)?.model;
					if (agentModel && !permitted.has(agentModel)) throw new Error(`Agent '${item.agent}' model is outside the parent model scope.`);
				}
			}
			const makeDetails = (mode: SubagentDetails["mode"]) => (results: SingleResult[]): SubagentDetails => ({ mode, agentScope, projectAgentsDir: discovery.projectAgentsDir, diagnostics: [...discovery.diagnostics], results });
			const mode = request.mode;
			if (agentScope === "project" || agentScope === "both") {
				const names = request.items.map((item) => item.agent);
				const project = names.map((name) => discovery.agents.find((item) => item.name === name)).filter((item): item is AgentConfig => item?.source === "project");
				if (project.length) {
					requireProjectApproval(ctx.hasUI);
					const description = project.map((item) => `${item.name}: ${item.model ?? defaults.model ?? "current model"}; tools: ${resolveChildTools(item, parentTools).join(", ") || "none"}`).join("\n");
					if (!(await ctx.ui.confirm("Run project-local agents?", `Source: ${discovery.projectAgentsDir}\n${description}\n\nProject agents are repo-controlled.`))) return { content: [{ type: "text", text: "Canceled: project-local agents not approved." }], details: makeDetails(mode)([]) };
				}
			}
			if (mode === "single") {
				const item = request.items[0];
				const result = await runSingleAgent(ctx.cwd, defaults, discovery.agents, parentTools, item.agent, item.task, item.cwd, undefined, PER_TASK_OUTPUT_CAP, limiter, signal, onUpdate, makeDetails("single"));
				const prefix = isFailedResult(result) ? "Agent failed: " : "";
				const output = `${prefix}${formatResultOutput(result, PER_TASK_OUTPUT_CAP - Buffer.byteLength(prefix, "utf8"))}`;
				return { content: [{ type: "text", text: truncateUtf8(output, PER_TASK_OUTPUT_CAP) }], details: makeDetails("single")([result]), usage: aggregateUsage([result]) };
			}
			if (mode === "chain") {
				const results: SingleResult[] = []; let previous = "";
				for (let index = 0; index < request.items.length; index++) {
					const item = request.items[index];
					const result = await runSingleAgent(ctx.cwd, defaults, discovery.agents, parentTools, item.agent, replacePreviousLiteral(item.task, previous), item.cwd, index + 1, PER_TASK_OUTPUT_CAP, limiter, signal, (partial) => { const current = partial.details?.results[0]; if (current) onUpdate?.({ content: [{ type: "text", text: formatProgress(current, `Step ${index + 1}/${request.items.length} · `) }], details: makeDetails("chain")([...results, current]) }); }, makeDetails("chain"));
					results.push(result);
					if (isFailedResult(result)) {
						const prefix = `Chain stopped at step ${index + 1} (${truncateUtf8(item.agent, MAX_METADATA_BYTES)}): `;
						const output = `${prefix}${formatResultOutput(result, Math.max(1, PER_TASK_OUTPUT_CAP - Buffer.byteLength(prefix, "utf8")))}`;
						return { content: [{ type: "text", text: truncateUtf8(output, PER_TASK_OUTPUT_CAP) }], details: makeDetails("chain")(results), usage: aggregateUsage(results) };
					}
					previous = formatResultOutput(result);
				}
				return { content: [{ type: "text", text: formatResultOutput(results.at(-1)!) }], details: makeDetails("chain")(results), usage: aggregateUsage(results) };
			}
			const parallelBudget = Math.min(PER_TASK_OUTPUT_CAP, Math.max(1, Math.floor((TOTAL_PARALLEL_OUTPUT_CAP - PARALLEL_OUTPUT_OVERHEAD_RESERVE) / request.items.length)));
			const all: SingleResult[] = request.items.map((item) => stateResult(undefined, item.agent, item.task, undefined, createRunnerState(), -1));
			const emitParallel = () => onUpdate?.({ content: [{ type: "text", text: all.map((result, index) => formatProgress(result, `Lane ${index + 1}/${all.length} · `)).join("\n") }], details: makeDetails("parallel")([...all]) });
			const results = await mapWithConcurrencyLimit(request.items, MAX_CONCURRENCY, async (item, index) => { const result = await runSingleAgent(ctx.cwd, defaults, discovery.agents, parentTools, item.agent, item.task, item.cwd, undefined, parallelBudget, limiter, signal, (partial) => { if (partial.details?.results[0]) { all[index] = partial.details.results[0]; emitParallel(); } }, makeDetails("parallel")); all[index] = result; emitParallel(); return result; });
			const summaries = results.map((result) => `### [${result.agent}] ${isFailedResult(result) ? "failed" : "completed"}\n\n${formatResultOutput(result, parallelBudget)}`);
			const combined = `Parallel: ${results.filter((result) => !isFailedResult(result)).length}/${results.length} succeeded\n\n${summaries.join("\n\n---\n\n")}`;
			return { content: [{ type: "text", text: truncateUtf8(combined, TOTAL_PARALLEL_OUTPUT_CAP) }], details: makeDetails("parallel")(results), usage: aggregateUsage(results) };
		},
	});
}
