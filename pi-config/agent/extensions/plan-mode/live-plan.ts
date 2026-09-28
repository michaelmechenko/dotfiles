import { chmodSync, existsSync, mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { PlanState } from "./plan-state.ts";

export interface LivePlanIdentity {
	pid: number;
	sessionId: string;
	sessionFile?: string;
	cwd: string;
	processStartedAt: string;
}

export interface LivePlanRecord extends LivePlanIdentity {
	version: 1;
	planId?: string;
	phase: PlanState["phase"];
	updatedAt: string;
	markdown: string;
}

function stateDir(): string {
	return process.env.PI_PLAN_STATE_DIR ?? "/tmp/pi-plan-state";
}

export function livePlanPath(pid = process.pid): string {
	return join(stateDir(), `${pid}.json`);
}

export function renderLivePlan(state: PlanState): string {
	const lines = ["# Current plan", "", `**Goal:** ${state.goal || "(not set)"}`, "", `**Phase:** ${state.phase}`, "", "## Steps", ""];
	for (const step of state.steps) lines.push(`- [${step.completed ? "x" : step.skipped ? "-" : " "}] ${step.text}`);
	if (state.criteria.length) lines.push("", "## Verification criteria", "", ...state.criteria.map((item) => `- ${item}`));
	if (state.followUps.length) lines.push("", "## Follow-up work", "", ...state.followUps.map((item) => `- ${item}`));
	const brief = state.executionBrief;
	if (brief.summary || brief.findings.length || brief.decisions.length || brief.relevantFiles.length || brief.constraints.length) {
		lines.push("", "## Execution brief", "");
		if (brief.summary) lines.push(brief.summary, "");
		if (brief.findings.length) lines.push("### Findings", "", ...brief.findings.map((item) => `- ${item}`), "");
		if (brief.decisions.length) lines.push("### Decisions", "", ...brief.decisions.map((item) => `- ${item}`), "");
		if (brief.relevantFiles.length) lines.push("### Relevant files", "", ...brief.relevantFiles.map((file) => `- \`${file.path}\` — ${file.note}`), "");
		if (brief.constraints.length) lines.push("### Constraints", "", ...brief.constraints.map((item) => `- ${item}`), "");
	}
	return `${lines.join("\n").trimEnd()}\n`;
}

export function publishLivePlan(identity: LivePlanIdentity, state: PlanState): void {
	// The live process owns its PID path. Clear any crash residue from an older
	// session after PID reuse; shutdown cleanup still uses the session guard.
	if (!identity.processStartedAt || !state.steps.length) return removeLivePlan(identity.pid);
	const dir = stateDir();
	mkdirSync(dir, { recursive: true, mode: 0o700 });
	chmodSync(dir, 0o700);
	const path = livePlanPath(identity.pid);
	const temporary = `${path}.${process.pid}.tmp`;
	const record: LivePlanRecord = {
		version: 1,
		...identity,
		planId: state.planId,
		phase: state.phase,
		updatedAt: new Date().toISOString(),
		markdown: renderLivePlan(state),
	};
	writeFileSync(temporary, `${JSON.stringify(record)}\n`, { encoding: "utf8", mode: 0o600 });
	chmodSync(temporary, 0o600);
	renameSync(temporary, path);
}

export function removeLivePlan(pid = process.pid, expectedSessionId?: string): void {
	const path = livePlanPath(pid);
	if (!existsSync(path)) return;
	if (expectedSessionId) {
		try {
			const record = JSON.parse(readFileSync(path, "utf8")) as Partial<LivePlanRecord>;
			if (record.sessionId !== expectedSessionId) return;
		} catch { return; }
	}
	unlinkSync(path);
}
