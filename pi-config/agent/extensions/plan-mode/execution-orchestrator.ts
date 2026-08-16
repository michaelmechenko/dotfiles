import { chmodSync, existsSync, mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { ModelSnapshot, PlanState, Workstream } from "./plan-state.ts";
import { acknowledgeExecutionPacket, deleteExecutionPacket, type ExecutionPacket, waitForExecutionAcknowledgement, writeExecutionPacket } from "./execution-handoff.ts";

export interface WorkerTarget { pane: string; window: string; }
export interface WorkerRecord { streamId: string; packetPath: string; releasePath: string; target?: WorkerTarget; acknowledged: boolean; reportPath: string; }
export interface ParallelRun { version: 1; id: string; phase: "provisioning" | "awaiting-acknowledgements" | "released" | "failed" | "reported"; source: ExecutionPacket["source"]; model: ModelSnapshot; workers: WorkerRecord[]; }
export interface TmuxRunner { (args: string[], timeout?: number): Promise<{ code: number; stdout: string; stderr: string }>; }

export function parallelDirectory(agentDir: string): string { return join(agentDir, "plan-parallel"); }
export function runPath(agentDir: string, id: string): string { return join(parallelDirectory(agentDir), `${id}.json`); }
export function scopedPlan(plan: PlanState, stream: Workstream): PlanState { const steps = plan.steps.filter((step) => stream.stepIds.includes(step.id)); return { ...plan, steps: steps.map((step) => ({ ...step })), workstreams: undefined, completionRequested: false }; }
export function createParallelRun(agentDir: string, plan: PlanState, source: ExecutionPacket["source"], model: ModelSnapshot): ParallelRun {
	if (!plan.workstreams?.length) throw new Error("Parallel execution requires validated workstreams.");
	const id = `${Date.now()}-${process.pid}-${Math.random().toString(36).slice(2, 10)}`;
	const workers = plan.workstreams.map((stream) => { const releasePath = join(parallelDirectory(agentDir), `${id}-${stream.id}.release`); const reportPath = join(parallelDirectory(agentDir), `${id}-${stream.id}.report`); const packetPath = writeExecutionPacket(agentDir, { version: 2, plan: scopedPlan(plan, stream), source, model, releasePath, reportPath }); return { streamId: stream.id, packetPath, releasePath, reportPath, acknowledged: false }; });
	const run: ParallelRun = { version: 1, id, phase: "provisioning", source, model, workers }; writeRun(agentDir, run); return run;
}

/** Launches in declaration order. Targets are tagged before acknowledgement and only tagged unreleased panes may be rolled back. */
export async function launchParallelRun(exec: TmuxRunner, agentDir: string, run: ParallelRun, plan: PlanState): Promise<ParallelRun> {
	if (!plan.workstreams?.length || run.phase !== "provisioning") return run;
	let current = run;
	try {
		for (const worker of current.workers) {
			const stream = plan.workstreams.find((item) => item.id === worker.streamId)!;
			const result = await exec(["new-window", "-d", "-P", "-F", "#{pane_id}\t#{window_id}", "-t", current.source.tmuxSession, "-c", current.source.cwd, "-e", `PI_PLAN_HANDOFF=${worker.packetPath}`, "-e", `PI_PLAN_PROVIDER=${current.model.provider}`, "-e", `PI_PLAN_MODEL=${current.model.model}`, "-e", `PI_PLAN_THINKING=${current.model.thinkingLevel}`, "-e", `PI_PLAN_STREAM=${stream.id}`, "pi --provider \"$PI_PLAN_PROVIDER\" --model \"$PI_PLAN_MODEL\" --thinking \"$PI_PLAN_THINKING\""]); if (result.code !== 0) throw new Error(result.stderr || "tmux worker launch failed");
			const [pane, window] = result.stdout.trim().split("\t"); if (!pane || !window) throw new Error("tmux worker target was not returned");
			const tagged = await exec(["set-option", "-p", "-t", pane, "@pi_plan_parallel_run", current.id], 3_000); if (tagged.code !== 0) throw new Error("could not tag worker pane");
			current = { ...current, workers: current.workers.map((item) => item.streamId === stream.id ? { ...item, target: { pane, window } } : item) }; writeRun(agentDir, current);
		}
		current = { ...current, phase: "awaiting-acknowledgements" }; writeRun(agentDir, current);
		for (const worker of current.workers) { if (!(await waitForExecutionAcknowledgement(agentDir, worker.packetPath, 5_000))) throw new Error(`Worker ${worker.streamId} did not acknowledge startup.`); current = { ...current, workers: current.workers.map((item) => item.streamId === worker.streamId ? { ...item, acknowledged: true } : item) }; writeRun(agentDir, current); }
		for (const worker of current.workers) writePrivate(worker.releasePath, "release\n");
		current = { ...current, phase: "released" }; writeRun(agentDir, current); return current;
	} catch (error) { await rollbackUnreleased(exec, agentDir, current).catch(() => {}); const failed = { ...current, phase: "failed" as const }; writeRun(agentDir, failed); throw error; }
}
export async function rollbackUnreleased(exec: TmuxRunner, agentDir: string, run: ParallelRun): Promise<void> { if (run.phase === "released") return; for (const worker of run.workers) { deleteExecutionPacket(agentDir, worker.packetPath); try { unlinkSync(worker.releasePath); } catch {} if (!worker.target) continue; const owner = await exec(["display-message", "-p", "-t", worker.target.pane, "#{@pi_plan_parallel_run}"], 3_000); if (owner.code === 0 && owner.stdout.trim() === run.id) await exec(["kill-pane", "-t", worker.target.pane], 3_000); } }
export function readParallelRun(agentDir: string, id: string): ParallelRun | undefined { try { const value = JSON.parse(readFileSync(runPath(agentDir, id), "utf8")); return isRun(value) ? value : undefined; } catch { return undefined; } }
export function reconcileParallelRun(agentDir: string, run: ParallelRun): ParallelRun { if (run.phase !== "released") return run; const reported = run.workers.every((worker) => existsSync(worker.reportPath)); return reported ? writeAndReturn(agentDir, { ...run, phase: "reported" }) : run; }
/** Applies only atomic worker reports; no worker can mutate another stream's plan state. */
export function applyWorkerReports(plan: PlanState, run: ParallelRun): PlanState {
	const byId = new Map(plan.steps.map((step) => [step.id, step]));
	for (const worker of run.workers) try { const report = JSON.parse(readFileSync(worker.reportPath, "utf8")) as { steps?: PlanState["steps"] }; for (const reported of report.steps ?? []) { const step = byId.get(reported.id); if (step) { step.completed = reported.completed; step.skipped = reported.skipped; } } } catch { /* incomplete report remains pending */ }
	return { ...plan, steps: plan.steps.map((step) => ({ ...step })) };
}
function writeRun(agentDir: string, run: ParallelRun): void { const dir = parallelDirectory(agentDir); mkdirSync(dir, { recursive: true, mode: 0o700 }); chmodSync(dir, 0o700); const path = runPath(agentDir, run.id); const tmp = `${path}.tmp`; writeFileSync(tmp, JSON.stringify(run), { encoding: "utf8", mode: 0o600 }); chmodSync(tmp, 0o600); renameSync(tmp, path); }
function writePrivate(path: string, text: string): void { writeFileSync(path, text, { encoding: "utf8", mode: 0o600 }); chmodSync(path, 0o600); }
function writeAndReturn(agentDir: string, run: ParallelRun): ParallelRun { writeRun(agentDir, run); return run; }
function isRun(value: unknown): value is ParallelRun { const run = value as Partial<ParallelRun>; return !!run && run.version === 1 && typeof run.id === "string" && (run.phase === "provisioning" || run.phase === "awaiting-acknowledgements" || run.phase === "released" || run.phase === "failed" || run.phase === "reported") && Array.isArray(run.workers); }
