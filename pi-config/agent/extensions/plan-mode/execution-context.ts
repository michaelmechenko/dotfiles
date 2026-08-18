import type { PlanState } from "./plan-state.ts";

export interface ExecutionContextSource {
	sessionId: string;
	cwd: string;
	tmuxSession?: string;
}

export type ExecutionContextKind = "kickoff" | "resume" | "recalibration";

/** The single execution handoff renderer. It deliberately carries no source transcript. */
export function renderExecutionContext(plan: PlanState, source: ExecutionContextSource, kind: ExecutionContextKind = "kickoff"): string {
	const lines = ["[PLAN EXECUTION]", "", heading(kind), "", `Source session: ${source.sessionId}`, `Working directory: ${source.cwd}`];
	if (source.tmuxSession) lines.push(`Source tmux session: ${source.tmuxSession}`);
	lines.push("", "## Goal", plan.goal || "(not set)", "", "## Execution brief", `Summary: ${plan.executionBrief.summary || "(legacy plan — recalibrate before relying on prior context)"}`, section("Findings", plan.executionBrief.findings), section("Decisions", plan.executionBrief.decisions), files(plan.executionBrief.relevantFiles), section("Constraints", plan.executionBrief.constraints), "", "## Plan status", ...plan.steps.map((step) => `${step.step}. [${step.completed ? "x" : step.skipped ? "-" : " "}] ${step.text}`));
	if (plan.criteria.length) lines.push("", "## Verification requirements", ...plan.criteria.map((item) => `- ${item}`));
	if (plan.followUps.length) lines.push("", "## Known follow-up work", ...plan.followUps.map((item) => `- ${item}`));
	lines.push("", instruction(kind));
	return lines.join("\n");
}

export function executionGuidance(): string {
	return "While executing, follow the active plan. Call plan_step immediately after each completed or skipped step. If scope or blockers change pending work, call plan_update with a complete replacement executionBrief. After every step is terminal, call plan_complete with outcome, end state, verification, deviations, and next steps.";
}

function heading(kind: ExecutionContextKind): string { return kind === "recalibration" ? "Recalibrate the active plan from this canonical context." : kind === "resume" ? "Resume the pending work from this canonical context." : "Start executing the handed-off plan from this canonical context."; }
function instruction(kind: ExecutionContextKind): string { return kind === "recalibration" ? "Inspect only, preserve terminal steps, replace pending work as needed, and call plan_update with a complete current executionBrief." : `${executionGuidance()} Execute pending steps in order.`; }
function section(title: string, items: string[]): string { return `\n## ${title}\n${items.length ? items.map((item) => `- ${item}`).join("\n") : "- None recorded."}`; }
function files(items: PlanState["executionBrief"]["relevantFiles"]): string { return `\n## Relevant files\n${items.length ? items.map((file) => `- ${file.path}: ${file.note}`).join("\n") : "- None recorded."}`; }
