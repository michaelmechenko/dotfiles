import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { existsSync, linkSync, mkdirSync, readdirSync, readFileSync, realpathSync, unlinkSync, watch, writeFileSync, type FSWatcher } from "node:fs";
import { dirname, join, resolve } from "node:path";
import type { ExecutionBrief, ModelSnapshot, PlanCloseout, PlanState } from "./plan-state.ts";
import type { TodoItem } from "./utils.ts";

export interface PlanProject {
	/** Canonical git-common-dir when available; canonical cwd otherwise. */
	id: string;
	kind: "git" | "cwd";
}

export interface CompletedPlanRecord {
	version: 1;
	id: string;
	project: PlanProject;
	sessionId: string;
	createdAt: string;
	completedAt: string;
	goal: string;
	steps: TodoItem[];
	criteria: string[];
	followUps: string[];
	executionBrief: ExecutionBrief;
	executionModel?: ModelSnapshot;
	closeout: PlanCloseout;
}

function canonicalPath(path: string): string {
	const resolved = resolve(path);
	try { return realpathSync.native(resolved); } catch { return resolved; }
}

/** Linked worktrees resolve to their shared common git directory. */
export function resolvePlanProject(cwd: string): PlanProject {
	try {
		const commonDir = execFileSync("git", ["rev-parse", "--path-format=absolute", "--git-common-dir"], { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
		if (commonDir) return { id: canonicalPath(commonDir), kind: "git" };
	} catch { /* non-git cwd */ }
	return { id: canonicalPath(cwd), kind: "cwd" };
}

export function planHistoryKey(project: PlanProject): string {
	return createHash("sha256").update(`${project.kind}\0${project.id}`).digest("hex");
}

export function planHistoryDirectory(agentDir: string, project: PlanProject): string {
	return join(agentDir, "plan-history", planHistoryKey(project));
}

const PLAN_ID = /^[A-Za-z0-9_-]+$/;

function cloneSteps(steps: TodoItem[]): TodoItem[] { return steps.map((step) => ({ ...step })); }
function cloneBrief(brief: ExecutionBrief): ExecutionBrief { return { summary: brief.summary, findings: [...brief.findings], decisions: [...brief.decisions], relevantFiles: brief.relevantFiles.map((file) => ({ ...file })), constraints: [...brief.constraints] }; }
function cloneCloseout(closeout: PlanCloseout): PlanCloseout { return { ...closeout, verification: [...closeout.verification], deviations: [...closeout.deviations], nextSteps: [...closeout.nextSteps] }; }

export function completedPlanRecord(state: PlanState, sessionId: string, project: PlanProject, closeout: PlanCloseout, completedAt = new Date().toISOString()): CompletedPlanRecord {
	if (!state.planId || !PLAN_ID.test(state.planId) || !state.createdAt) throw new Error("Cannot archive a plan without stable identity.");
	return { version: 1, id: state.planId, project, sessionId, createdAt: state.createdAt, completedAt, goal: state.goal, steps: cloneSteps(state.steps), criteria: [...state.criteria], followUps: [...state.followUps], executionBrief: cloneBrief(state.executionBrief), executionModel: state.executionModel ? { ...state.executionModel } : undefined, closeout: cloneCloseout(closeout) };
}

/** Atomic, idempotent per-plan archive. A duplicate ID must represent the exact same closeout. */
export function archiveCompletedPlan(agentDir: string, record: CompletedPlanRecord): string {
	const dir = planHistoryDirectory(agentDir, record.project);
	mkdirSync(dir, { recursive: true, mode: 0o700 });
	const path = join(dir, `${record.id}.json`);
	const content = `${JSON.stringify(record, null, "\t")}\n`;
	if (existsSync(path)) {
		if (!sameCompletedPlan(readFileSync(path, "utf8"), record)) throw new Error(`Plan history already contains a different record for ${record.id}.`);
		return path;
	}
	const tmp = join(dirname(path), `.${record.id}.${process.pid}.${Date.now()}.tmp`);
	writeFileSync(tmp, content, { encoding: "utf8", mode: 0o600 });
	try {
		// link(2) publishes without replacing an existing record, unlike rename.
		linkSync(tmp, path);
	} catch (error) {
		if (!existsSync(path) || !sameCompletedPlan(readFileSync(path, "utf8"), record)) throw error;
	} finally {
		try { unlinkSync(tmp); } catch { /* publication succeeded or cleanup raced */ }
	}
	return path;
}

function sameCompletedPlan(existingContent: string, incoming: CompletedPlanRecord): boolean {
	try {
		const existing = JSON.parse(existingContent) as CompletedPlanRecord;
		const { completedAt: _existingCompletedAt, ...existingStable } = existing;
		const { completedAt: _incomingCompletedAt, ...incomingStable } = incoming;
		return JSON.stringify(existingStable) === JSON.stringify(incomingStable);
	} catch { return false; }
}

function isCompletedPlanRecord(value: unknown): value is CompletedPlanRecord {
	if (!value || typeof value !== "object") return false;
	const record = value as Partial<CompletedPlanRecord>;
	return record.version === 1 && typeof record.id === "string" && PLAN_ID.test(record.id) && !!record.project && typeof record.project === "object"
		&& typeof record.project.id === "string" && (record.project.kind === "git" || record.project.kind === "cwd")
		&& typeof record.sessionId === "string" && typeof record.createdAt === "string" && typeof record.completedAt === "string"
		&& typeof record.goal === "string" && Array.isArray(record.steps) && !!record.closeout;
}

/** Invalid or partial records are ignored, never allowed to break the footer. */
export function listCompletedPlans(agentDir: string, project: PlanProject): CompletedPlanRecord[] {
	const dir = planHistoryDirectory(agentDir, project);
	if (!existsSync(dir)) return [];
	const records: CompletedPlanRecord[] = [];
	for (const name of readdirSync(dir)) {
		if (!name.endsWith(".json")) continue;
		try {
			const record = JSON.parse(readFileSync(join(dir, name), "utf8"));
			if (isCompletedPlanRecord(record)) records.push(record);
		} catch { /* ignore interrupted or manually damaged records */ }
	}
	return records.sort((a, b) => a.completedAt.localeCompare(b.completedAt));
}

/** Project storage is shared, while the footer count belongs to one source session. */
export function listCompletedPlansForSession(agentDir: string, project: PlanProject, sessionId: string): CompletedPlanRecord[] {
	return listCompletedPlans(agentDir, project).filter((record) => record.sessionId === sessionId);
}

/** Watch one project directory only; callers close it with their session. */
export function watchCompletedPlans(agentDir: string, project: PlanProject, listener: () => void): FSWatcher {
	const dir = planHistoryDirectory(agentDir, project);
	mkdirSync(dir, { recursive: true, mode: 0o700 });
	return watch(dir, { persistent: false }, listener);
}
