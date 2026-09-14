import { resolve } from "node:path";
import type { AgentConfig } from "./agents.ts";

export const MAX_PARALLEL_TASKS = 8;
export const MAX_CHAIN_STEPS = 8;
export const MAX_CONCURRENCY = 4;

const CHILD_DENIED_TOOLS = new Set(["subagent", "plan_update", "plan_step", "plan_complete"]);

export interface DelegationItem {
	agent: string;
	task: string;
	cwd: string;
}

export type DelegationRequest =
	| { mode: "single"; items: [DelegationItem] }
	| { mode: "parallel"; items: DelegationItem[] }
	| { mode: "chain"; items: DelegationItem[] };

export interface RawDelegationParams {
	agent?: string;
	task?: string;
	cwd?: string;
	tasks?: Array<{ agent: string; task: string; cwd?: string }>;
	chain?: Array<{ agent: string; task: string; cwd?: string }>;
}

function normalizeItem(item: { agent?: unknown; task?: unknown; cwd?: unknown }, defaultCwd: string): DelegationItem {
	const agent = typeof item.agent === "string" ? item.agent.trim() : "";
	const task = typeof item.task === "string" ? item.task.trim() : "";
	if (!agent || !task) throw new Error("Every delegated item requires a nonblank agent and task.");
	if (item.cwd !== undefined && (typeof item.cwd !== "string" || !item.cwd.trim())) {
		throw new Error("A delegated cwd must be a nonblank path when provided.");
	}
	return { agent, task, cwd: resolve(defaultCwd, typeof item.cwd === "string" ? item.cwd : defaultCwd) };
}

/** Validate and normalize exactly one public delegation mode before any discovery or I/O. */
export function normalizeDelegationRequest(params: RawDelegationParams, defaultCwd: string): DelegationRequest {
	const hasSingleFields = params.agent !== undefined || params.task !== undefined || params.cwd !== undefined;
	const hasTasks = params.tasks !== undefined;
	const hasChain = params.chain !== undefined;
	if (Number(hasSingleFields) + Number(hasTasks) + Number(hasChain) !== 1) {
		throw new Error("Invalid parameters. Provide exactly one of agent/task, tasks, or chain.");
	}
	if (hasSingleFields) return { mode: "single", items: [normalizeItem(params, defaultCwd)] };
	if (hasTasks) {
		if (!params.tasks?.length) throw new Error("Parallel delegation requires at least one task.");
		if (params.tasks.length > MAX_PARALLEL_TASKS) throw new Error(`Too many parallel tasks (${params.tasks.length}). Max is ${MAX_PARALLEL_TASKS}.`);
		return { mode: "parallel", items: params.tasks.map((item) => normalizeItem(item, defaultCwd)) };
	}
	if (!params.chain?.length) throw new Error("Chain delegation requires at least one step.");
	if (params.chain.length > MAX_CHAIN_STEPS) throw new Error(`Too many chain steps (${params.chain.length}). Max is ${MAX_CHAIN_STEPS}.`);
	return { mode: "chain", items: params.chain.map((item) => normalizeItem(item, defaultCwd)) };
}

/** A child may narrow the parent's effective tools, never widen them. */
export function resolveChildTools(agent: Pick<AgentConfig, "tools">, parentTools: Iterable<string>): string[] {
	const parent = [...new Set(parentTools)].filter((name) => !CHILD_DENIED_TOOLS.has(name));
	if (agent.tools === undefined) return parent;
	const allowed = new Set(agent.tools);
	return parent.filter((name) => allowed.has(name));
}

export function replacePreviousLiteral(task: string, previous: string): string {
	return task.replace(/\{previous\}/g, () => previous);
}
