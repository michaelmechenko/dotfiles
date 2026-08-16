import { chmodSync, existsSync, lstatSync, mkdirSync, readFileSync, renameSync, unlinkSync, watch, writeFileSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import type { ModelSnapshot, PlanState } from "./plan-state.ts";
import { isPlanState } from "./plan-state.ts";
import { isModelSnapshot } from "./config.ts";

export interface TmuxTarget { session: string; window: string; pane: string; }
export interface ExecutionPacket { version: 2; plan: PlanState; source: { sessionId: string; cwd: string; tmuxSession: string }; model: ModelSnapshot; releasePath?: string; reportPath?: string; }

export function renderPlanMarkdown(plan: PlanState): string {
	const lines = ["# Plan", "", "## Goal", plan.goal || "(not set)", "", "## Steps"];
	for (const step of plan.steps) lines.push(`${step.completed ? "- [x]" : step.skipped ? "- [-]" : "- [ ]"} ${step.text}`);
	if (plan.criteria.length) lines.push("", "## Verification", ...plan.criteria.map((item) => `- ${item}`));
	if (plan.followUps.length) lines.push("", "## Follow-up work", ...plan.followUps.map((item) => `- ${item}`));
	return `${lines.join("\n")}\n`;
}
export function handoffDirectory(agentDir: string): string { return join(agentDir, "plan-handoffs"); }
export function writeExecutionPacket(agentDir: string, packet: ExecutionPacket): string {
	if (!isExecutionPacket(packet)) throw new Error("Invalid plan handoff packet.");
	const dir = handoffDirectory(agentDir); mkdirSync(dir, { recursive: true, mode: 0o700 }); chmodSync(dir, 0o700);
	const path = join(dir, `${Date.now()}-${process.pid}-${Math.random().toString(36).slice(2)}.json`); const tmp = `${path}.tmp`;
	writeFileSync(tmp, JSON.stringify(packet), { encoding: "utf8", mode: 0o600 }); chmodSync(tmp, 0o600); renameSync(tmp, path); return path;
}
/** Delete packet and acknowledgement. Paths outside the private handoff directory are ignored. */
export function deleteExecutionPacket(agentDir: string, handoffPath: string): void {
	for (const path of [handoffPath, acknowledgementPath(handoffPath)]) if (isPrivatePath(agentDir, path)) try { unlinkSync(path); } catch { /* already consumed */ }
}
/** Read and delete a handoff exactly once. Invalid files are deleted too. */
export function consumeExecutionPacket(agentDir: string, handoffPath: string): ExecutionPacket | undefined {
	if (!isPrivatePath(agentDir, handoffPath) || !existsSync(handoffPath)) return undefined;
	try { const stat = lstatSync(handoffPath); if (!stat.isFile() || (stat.mode & 0o077) !== 0) return undefined; const parsed = JSON.parse(readFileSync(handoffPath, "utf8")); return isExecutionPacket(parsed) ? parsed : undefined; } catch { return undefined; } finally { if (isPrivatePath(agentDir, handoffPath)) try { unlinkSync(handoffPath); } catch { /* one-time delivery */ } }
}
export function writeWorkerReport(path: string, report: unknown): void { const tmp = `${path}.tmp`; writeFileSync(tmp, JSON.stringify(report), { encoding: "utf8", mode: 0o600 }); chmodSync(tmp, 0o600); renameSync(tmp, path); }
export function acknowledgeExecutionPacket(agentDir: string, handoffPath: string): boolean {
	const path = acknowledgementPath(handoffPath); if (!isPrivatePath(agentDir, handoffPath) || !isPrivatePath(agentDir, path)) return false;
	try { writeFileSync(path, "consumed\n", { encoding: "utf8", mode: 0o600, flag: "wx" }); return true; } catch { return false; }
}
export async function waitForRelease(path: string, timeoutMs = 30_000): Promise<boolean> {
	if (existsSync(path)) return true;
	return new Promise((done) => { let watcher: ReturnType<typeof watch> | undefined; const finish = (value: boolean) => { clearTimeout(timeout); watcher?.close(); done(value); }; const timeout = setTimeout(() => finish(false), timeoutMs); try { watcher = watch(dirname(path), () => { if (existsSync(path)) finish(true); }); } catch { finish(false); } });
}
export async function waitForExecutionAcknowledgement(agentDir: string, handoffPath: string, timeoutMs = 5_000): Promise<boolean> {
	const path = acknowledgementPath(handoffPath); if (!isPrivatePath(agentDir, handoffPath) || !isPrivatePath(agentDir, path)) return false;
	const until = Date.now() + timeoutMs;
	while (Date.now() < until) { if (existsSync(path)) { try { const stat = lstatSync(path); if (stat.isFile() && (stat.mode & 0o077) === 0 && readFileSync(path, "utf8") === "consumed\n") return true; } catch { /* retry until timeout */ } } await new Promise((resolve) => setTimeout(resolve, 25)); }
	return false;
}
function acknowledgementPath(handoffPath: string): string { return `${handoffPath}.ack`; }
function handoffEnvironment(handoffPath: string, model: ModelSnapshot): string[] { if (!isModelSnapshot(model)) throw new Error("Invalid execution model."); return ["-e", `PI_PLAN_HANDOFF=${handoffPath}`, "-e", `PI_PLAN_PROVIDER=${model.provider}`, "-e", `PI_PLAN_MODEL=${model.model}`, "-e", `PI_PLAN_THINKING=${model.thinkingLevel}`]; }
function handoffCommand(): string { return "pi --provider \"$PI_PLAN_PROVIDER\" --model \"$PI_PLAN_MODEL\" --thinking \"$PI_PLAN_THINKING\""; }
export function buildTmuxNewWindowArgs(target: TmuxTarget, cwd: string, handoffPath: string, model: ModelSnapshot): string[] { return ["new-window", "-d", "-t", target.session, "-c", cwd, ...handoffEnvironment(handoffPath, model), handoffCommand()]; }
export function buildTmuxDetachedPaneArgs(target: TmuxTarget, cwd: string, handoffPath: string, model: ModelSnapshot): string[] { return ["split-window", "-d", "-v", "-t", target.pane, "-c", cwd, ...handoffEnvironment(handoffPath, model), handoffCommand()]; }
function isPrivatePath(agentDir: string, candidate: string): boolean { const dir = resolve(handoffDirectory(agentDir)); const path = resolve(candidate); return dirname(path) === dir && !basename(path).includes(".."); }
function isExecutionPacket(value: unknown): value is ExecutionPacket { if (!value || typeof value !== "object") return false; const packet = value as Partial<ExecutionPacket>; return packet.version === 2 && isModelSnapshot(packet.model) && isPlanState(packet.plan) && !!packet.source && typeof packet.source === "object" && typeof packet.source.sessionId === "string" && typeof packet.source.cwd === "string" && typeof packet.source.tmuxSession === "string" && (packet.releasePath === undefined || typeof packet.releasePath === "string") && (packet.reportPath === undefined || typeof packet.reportPath === "string"); }
