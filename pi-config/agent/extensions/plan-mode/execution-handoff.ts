import { chmodSync, existsSync, lstatSync, mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import type { ModelSnapshot, PlanState } from "./plan-state.ts";
import { isModelSnapshot } from "./config.ts";

export interface TmuxTarget {
	session: string;
	window: string;
	pane: string;
}

export interface ExecutionPacket {
	version: 1;
	plan: PlanState;
	markdown: string;
	source: { sessionId: string; cwd: string; tmuxSession: string };
	model: ModelSnapshot;
}

export function renderPlanMarkdown(plan: PlanState): string {
	const lines = ["# Plan", "", `## Goal`, plan.goal || "(not set)", "", "## Steps"];
	for (const step of plan.steps) lines.push(`${step.completed ? "- [x]" : step.skipped ? "- [-]" : "- [ ]"} ${step.text}`);
	if (plan.criteria.length) lines.push("", "## Verification", ...plan.criteria.map((item) => `- ${item}`));
	if (plan.followUps.length) lines.push("", "## Follow-up work", ...plan.followUps.map((item) => `- ${item}`));
	return `${lines.join("\n")}\n`;
}

export function handoffDirectory(agentDir: string): string {
	return join(agentDir, "plan-handoffs");
}

export function writeExecutionPacket(agentDir: string, packet: ExecutionPacket): string {
	if (!isExecutionPacket(packet)) throw new Error("Invalid plan handoff packet.");
	const dir = handoffDirectory(agentDir);
	mkdirSync(dir, { recursive: true, mode: 0o700 });
	chmodSync(dir, 0o700);
	const path = join(dir, `${Date.now()}-${process.pid}-${Math.random().toString(36).slice(2)}.json`);
	const tmp = `${path}.tmp`;
	writeFileSync(tmp, JSON.stringify(packet), { encoding: "utf8", mode: 0o600 });
	chmodSync(tmp, 0o600);
	renameSync(tmp, path);
	return path;
}

/** Read and delete a handoff exactly once. Invalid files are deleted too. */
export function deleteExecutionPacket(agentDir: string, handoffPath: string): void {
	const dir = resolve(handoffDirectory(agentDir));
	const path = resolve(handoffPath);
	if (dirname(path) !== dir || basename(path).includes("..")) return;
	try { unlinkSync(path); } catch { /* launch cleanup tolerates an already-consumed file */ }
}

export function consumeExecutionPacket(agentDir: string, handoffPath: string): ExecutionPacket | undefined {
	const dir = resolve(handoffDirectory(agentDir));
	const path = resolve(handoffPath);
	if (dirname(path) !== dir || basename(path).includes("..") || !existsSync(path)) return undefined;
	try {
		const stat = lstatSync(path);
		if (!stat.isFile() || (stat.mode & 0o077) !== 0) return undefined;
		const parsed = JSON.parse(readFileSync(path, "utf8"));
		return isExecutionPacket(parsed) ? parsed : undefined;
	} catch {
		return undefined;
	} finally {
		deleteExecutionPacket(agentDir, path);
	}
}

function handoffEnvironment(handoffPath: string, model: ModelSnapshot): string[] {
	if (!isModelSnapshot(model)) throw new Error("Invalid execution model.");
	return [
		"-e", `PI_PLAN_HANDOFF=${handoffPath}`,
		"-e", `PI_PLAN_PROVIDER=${model.provider}`,
		"-e", `PI_PLAN_MODEL=${model.model}`,
		"-e", `PI_PLAN_THINKING=${model.thinkingLevel}`,
	];
}

function handoffCommand(): string {
	return "pi --provider \"$PI_PLAN_PROVIDER\" --model \"$PI_PLAN_MODEL\" --thinking \"$PI_PLAN_THINKING\"";
}

/** Detached so creating a handoff never selects its window. */
export function buildTmuxNewWindowArgs(target: TmuxTarget, cwd: string, handoffPath: string, model: ModelSnapshot): string[] {
	return ["new-window", "-d", "-t", target.session, "-c", cwd, ...handoffEnvironment(handoffPath, model), handoffCommand()];
}

/** Detached horizontal split in the source window, preserving the source pane focus. */
export function buildTmuxDetachedPaneArgs(target: TmuxTarget, cwd: string, handoffPath: string, model: ModelSnapshot): string[] {
	return ["split-window", "-d", "-h", "-t", target.window, "-c", cwd, ...handoffEnvironment(handoffPath, model), handoffCommand()];
}

function isExecutionPacket(value: unknown): value is ExecutionPacket {
	if (!value || typeof value !== "object") return false;
	const packet = value as Partial<ExecutionPacket>;
	return packet.version === 1 && typeof packet.markdown === "string" && isModelSnapshot(packet.model)
		&& isPlanState(packet.plan)
		&& !!packet.source && typeof packet.source === "object"
		&& typeof packet.source.sessionId === "string" && typeof packet.source.cwd === "string" && typeof packet.source.tmuxSession === "string";
}

function isPlanState(value: unknown): value is PlanState {
	if (!value || typeof value !== "object") return false;
	const plan = value as Partial<PlanState>;
	return plan.version === 3 && typeof plan.goal === "string" && Array.isArray(plan.steps)
		&& plan.steps.every((step) => !!step && typeof step === "object" && typeof (step as { text?: unknown }).text === "string" && typeof (step as { completed?: unknown }).completed === "boolean" && typeof (step as { skipped?: unknown }).skipped === "boolean")
		&& Array.isArray(plan.criteria) && plan.criteria.every((item) => typeof item === "string")
		&& Array.isArray(plan.followUps) && plan.followUps.every((item) => typeof item === "string")
		&& (plan.accessMode === "none" || plan.accessMode === "plan" || plan.accessMode === "read-only")
		&& (plan.phase === "idle" || plan.phase === "drafting" || plan.phase === "ready" || plan.phase === "revising" || plan.phase === "executing" || plan.phase === "paused" || plan.phase === "handed-off");
}
