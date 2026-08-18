import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { homedir } from "node:os";
import type { ModelSnapshot, ThinkingLevel } from "./plan-state.ts";

export interface PlanModeConfig {
	/** Absent until a user explicitly saves a validated execution default. */
	executionModel?: ModelSnapshot;
}

const THINKING_LEVELS = new Set<ThinkingLevel>(["off", "minimal", "low", "medium", "high", "xhigh", "max"]);

export function isModelSnapshot(value: unknown): value is ModelSnapshot {
	if (!value || typeof value !== "object") return false;
	const model = value as Partial<ModelSnapshot>;
	return typeof model.provider === "string" && model.provider.trim().length > 0 && !/[\0\r\n]/.test(model.provider)
		&& typeof model.model === "string" && model.model.trim().length > 0 && !/[\0\r\n]/.test(model.model)
		&& typeof model.thinkingLevel === "string" && THINKING_LEVELS.has(model.thinkingLevel as ThinkingLevel);
}

function defaultAgentDir(): string {
	return process.env.PI_CODING_AGENT_DIR ?? join(homedir(), ".pi", "agent");
}

export function planModeConfigPath(agentDir = defaultAgentDir()): string {
	return join(agentDir, "plan-mode.json");
}

export function loadPlanModeConfig(agentDir = defaultAgentDir()): PlanModeConfig {
	const path = planModeConfigPath(agentDir);
	if (!existsSync(path)) return {};
	try {
		const parsed = JSON.parse(readFileSync(path, "utf8")) as { executionModel?: unknown };
		return isModelSnapshot(parsed.executionModel) ? { executionModel: { ...parsed.executionModel } } : {};
	} catch {
		return {};
	}
}

/** Atomically update only plan-mode.json's executionModel, preserving unrelated keys. */
export function savePlanModeConfig(executionModel: ModelSnapshot, agentDir = defaultAgentDir()): void {
	if (!isModelSnapshot(executionModel)) throw new Error("Invalid plan execution model.");
	const path = planModeConfigPath(agentDir);
	mkdirSync(dirname(path), { recursive: true });
	let existing: Record<string, unknown> = {};
	if (existsSync(path)) {
		try {
			const parsed = JSON.parse(readFileSync(path, "utf8"));
			if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) existing = parsed as Record<string, unknown>;
		} catch {
			throw new Error("Cannot update malformed plan-mode.json.");
		}
	}
	const tmp = join(dirname(path), `.${Date.now()}-${process.pid}.plan-mode.json.tmp`);
	writeFileSync(tmp, `${JSON.stringify({ ...existing, executionModel }, null, "\t")}\n`, { encoding: "utf8", mode: 0o600 });
	renameSync(tmp, path);
}
