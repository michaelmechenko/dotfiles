import { chmodSync, existsSync, lstatSync, mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import { processStartToken } from "../session-state/process-identity.ts";
import { basename, dirname, join, resolve } from "node:path";
import type { ModelSnapshot, PlanState } from "./plan-state.ts";
import { isPlanState, migratePlanState } from "./plan-state.ts";
import { isModelSnapshot } from "./config.ts";
import { spawnedPiCommand, splitDirectionArgs, type TmuxPaneDirection } from "../tmux/runtime.ts";

export interface TmuxTarget { session: string; window: string; pane: string; }
export interface ExecutionPacket { version: 2; plan: PlanState; source: { sessionId: string; cwd: string; tmuxSession: string }; model: ModelSnapshot; }

export function renderPlanMarkdown(plan: PlanState): string {
	const lines = ["# Plan", "", "## Goal", plan.goal || "(not set)", "", "## Steps"];
	for (const step of plan.steps) lines.push(`${step.completed ? "- [x]" : step.skipped ? "- [-]" : "- [ ]"} ${step.text}`);
	if (plan.criteria.length) lines.push("", "## Verification", ...plan.criteria.map((item) => `- ${item}`));
	if (plan.followUps.length) lines.push("", "## Follow-up work", ...plan.followUps.map((item) => `- ${item}`));
	lines.push("", "## Execution brief", "", "### Summary", plan.executionBrief.summary || "(not set)");
	if (plan.executionBrief.findings.length) lines.push("", "### Findings", ...plan.executionBrief.findings.map((item) => `- ${item}`));
	if (plan.executionBrief.decisions.length) lines.push("", "### Decisions", ...plan.executionBrief.decisions.map((item) => `- ${item}`));
	if (plan.executionBrief.relevantFiles.length) lines.push("", "### Relevant files", ...plan.executionBrief.relevantFiles.map((file) => `- \`${file.path}\` — ${file.note}`));
	if (plan.executionBrief.constraints.length) lines.push("", "### Constraints", ...plan.executionBrief.constraints.map((item) => `- ${item}`));
	return `${lines.join("\n")}\n`;
}
export function handoffDirectory(agentDir: string): string { return join(agentDir, "plan-handoffs"); }
export function writeExecutionPacket(agentDir: string, packet: ExecutionPacket): string {
	if (!isExecutionPacket(packet)) throw new Error("Invalid plan handoff packet.");
	const dir = handoffDirectory(agentDir); mkdirSync(dir, { recursive: true, mode: 0o700 }); chmodSync(dir, 0o700);
	const path = join(dir, `${Date.now()}-${process.pid}-${Math.random().toString(36).slice(2)}.json`); const tmp = `${path}.tmp`;
	writeFileSync(tmp, JSON.stringify(packet), { encoding: "utf8", mode: 0o600 }); chmodSync(tmp, 0o600); renameSync(tmp, path); return path;
}
/** Delete packet lifecycle files. Paths outside the private handoff directory are ignored. */
export function deleteExecutionPacket(agentDir: string, handoffPath: string): void {
	for (const path of [handoffPath, claimPath(handoffPath), acknowledgementPath(handoffPath)]) if (isPrivatePath(agentDir, path)) try { unlinkSync(path); } catch { /* already cleaned */ }
}
/** Claim a handoff exactly once without deleting the durable packet before readiness. */
export function consumeExecutionPacket(agentDir: string, handoffPath: string): ExecutionPacket | undefined {
	if (!isPrivatePath(agentDir, handoffPath) || !existsSync(handoffPath)) return undefined;
	const claim = claimPath(handoffPath);
	if (!isPrivatePath(agentDir, claim)) return undefined;
	let ownsClaim = false;
	try {
		writeFileSync(claim, `${JSON.stringify({ pid: process.pid, processStartedAt: processStartToken(), claimedAt: new Date().toISOString() })}\n`, { encoding: "utf8", mode: 0o600, flag: "wx" });
		ownsClaim = true;
		const stat = lstatSync(handoffPath);
		if (!stat.isFile() || (stat.mode & 0o077) !== 0) throw new Error("Unsafe handoff packet permissions.");
		const parsed = JSON.parse(readFileSync(handoffPath, "utf8"));
		if (!isExecutionPacket(parsed)) throw new Error("Invalid handoff packet.");
		const plan = migratePlanState(parsed.plan);
		if (!plan) throw new Error("Invalid handoff plan state.");
		return { ...parsed, plan };
	} catch {
		if (ownsClaim) try { unlinkSync(claim); } catch { /* cleanup raced */ }
		return undefined;
	}
}
export function acknowledgeExecutionPacket(agentDir: string, handoffPath: string): boolean {
	const path = acknowledgementPath(handoffPath); if (!isPrivatePath(agentDir, handoffPath) || !isPrivatePath(agentDir, path)) return false;
	try { writeFileSync(path, "consumed\n", { encoding: "utf8", mode: 0o600, flag: "wx" }); return true; } catch { return false; }
}
export type ExecutionAcknowledgement = "ready" | "claimed" | "unclaimed";
export type ExecutionOwner = "ready" | "live" | "dead" | "unknown";
/** A dead owner may be reclaimed only by an explicit user-confirmed operation. */
export function executionOwner(agentDir: string, handoffPath: string): ExecutionOwner {
	if (!isPrivatePath(agentDir, handoffPath)) return "unknown";
	const claim = claimPath(handoffPath);
	try {
		const stat = lstatSync(claim);
		if (!stat.isFile() || (stat.mode & 0o077) !== 0) return "unknown";
		const { pid, processStartedAt, cancelled } = JSON.parse(readFileSync(claim, "utf8"));
		if (cancelled || !Number.isInteger(pid) || pid <= 0 || typeof processStartedAt !== "string" || !processStartedAt) return "unknown";
		const instance = claimInstance(pid, processStartedAt);
		if (instance === "live") return validAcknowledgement(acknowledgementPath(handoffPath)) ? "ready" : "live";
		return instance;
	} catch { return "unknown"; }
}
/** Fenced unlink: another source cannot simultaneously reclaim the same claim. */
export function reclaimDeadExecutionPacket(agentDir: string, handoffPath: string): boolean {
	if (executionOwner(agentDir, handoffPath) !== "dead") return false;
	const tombstone = `${handoffPath}.reclaiming`;
	try {
		// Keep the dead claim in place. Renaming the packet fences every child
		// consumer, and the stable tombstone survives an interrupted recovery.
		if (existsSync(handoffPath)) renameSync(handoffPath, tombstone);
		if (!existsSync(tombstone)) return false;
		return executionOwner(agentDir, handoffPath) === "dead";
	} catch { return false; }
}
/** Call only after the source's paused state has been persisted. */
export function finishRecoveredExecutionPacket(agentDir: string, handoffPath: string): void {
	if (!isPrivatePath(agentDir, handoffPath) || !existsSync(`${handoffPath}.reclaiming`)) return;
	for (const path of [`${handoffPath}.reclaiming`, claimPath(handoffPath), acknowledgementPath(handoffPath)]) {
		try { unlinkSync(path); } catch { /* best effort: interrupted cleanup is harmless */ }
	}
}
/** Atomically fence a not-yet-claimed packet before returning ownership to the source. */
export function cancelUnclaimedExecutionPacket(agentDir: string, handoffPath: string): boolean {
	const claim = claimPath(handoffPath);
	if (!isPrivatePath(agentDir, handoffPath) || !isPrivatePath(agentDir, claim)) return false;
	try {
		writeFileSync(claim, `${JSON.stringify({ cancelled: true, pid: process.pid })}\n`, { encoding: "utf8", mode: 0o600, flag: "wx" });
	} catch { return false; }
	try { unlinkSync(handoffPath); } catch { /* already unavailable */ }
	try { unlinkSync(acknowledgementPath(handoffPath)); } catch { /* not ready */ }
	try { unlinkSync(claim); } catch { /* cleanup raced */ }
	return true;
}
export async function waitForExecutionAcknowledgement(agentDir: string, handoffPath: string, timeoutMs = 5_000): Promise<ExecutionAcknowledgement> {
	const path = acknowledgementPath(handoffPath); if (!isPrivatePath(agentDir, handoffPath) || !isPrivatePath(agentDir, path)) return "unclaimed";
	const until = Date.now() + timeoutMs;
	while (Date.now() < until) { if (validAcknowledgement(path)) return "ready"; await new Promise((resolve) => setTimeout(resolve, 25)); }
	return liveClaim(claimPath(handoffPath)) ? "claimed" : "unclaimed";
}
function validAcknowledgement(path: string): boolean { try { const stat = lstatSync(path); return stat.isFile() && (stat.mode & 0o077) === 0 && readFileSync(path, "utf8") === "consumed\n"; } catch { return false; } }
function claimInstance(pid: number, startedAt: string): "live" | "dead" | "unknown" {
	try { process.kill(pid, 0); } catch (error) { return (error as NodeJS.ErrnoException).code === "ESRCH" ? "dead" : "unknown"; }
	const current = processStartToken(pid);
	return current ? current === startedAt ? "live" : "dead" : "unknown";
}
function liveClaim(path: string): boolean {
	try {
		const stat = lstatSync(path); if (!stat.isFile() || (stat.mode & 0o077) !== 0) return false;
		const { pid, processStartedAt } = JSON.parse(readFileSync(path, "utf8"));
		return Number.isInteger(pid) && pid > 0 && Boolean(processStartedAt) && claimInstance(pid, processStartedAt) === "live";
	} catch { return false; }
}
function claimPath(handoffPath: string): string { return `${handoffPath}.claim`; }
function acknowledgementPath(handoffPath: string): string { return `${handoffPath}.ack`; }
function handoffEnvironment(handoffPath: string, model: ModelSnapshot): string[] { if (!isModelSnapshot(model)) throw new Error("Invalid execution model."); return ["-e", `PI_PLAN_HANDOFF=${handoffPath}`, "-e", `PI_PLAN_PROVIDER=${model.provider}`, "-e", `PI_PLAN_MODEL=${model.model}`, "-e", `PI_PLAN_THINKING=${model.thinkingLevel}`]; }
function handoffCommand(): string { return spawnedPiCommand("pi --provider \"$PI_PLAN_PROVIDER\" --model \"$PI_PLAN_MODEL\" --thinking \"$PI_PLAN_THINKING\""); }
export function buildTmuxNewWindowArgs(target: TmuxTarget, cwd: string, handoffPath: string, model: ModelSnapshot): string[] { return ["new-window", "-d", "-t", target.session, "-c", cwd, ...handoffEnvironment(handoffPath, model), handoffCommand()]; }
export function buildTmuxDetachedPaneArgs(target: TmuxTarget, cwd: string, handoffPath: string, model: ModelSnapshot, direction: TmuxPaneDirection = "below"): string[] { return ["split-window", "-d", splitDirectionArgs(direction), "-t", target.pane, "-c", cwd, ...handoffEnvironment(handoffPath, model), handoffCommand()]; }
function isPrivatePath(agentDir: string, candidate: string): boolean { const dir = resolve(handoffDirectory(agentDir)); const path = resolve(candidate); return dirname(path) === dir && !basename(path).includes(".."); }
function isExecutionPacket(value: unknown): value is ExecutionPacket { if (!value || typeof value !== "object") return false; const packet = value as Partial<ExecutionPacket>; return packet.version === 2 && isModelSnapshot(packet.model) && isPlanState(packet.plan) && !!packet.source && typeof packet.source === "object" && typeof packet.source.sessionId === "string" && typeof packet.source.cwd === "string" && typeof packet.source.tmuxSession === "string"; }
