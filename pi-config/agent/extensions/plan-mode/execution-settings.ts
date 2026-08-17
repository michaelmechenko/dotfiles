import type { ModelSnapshot, ThinkingLevel } from "./plan-state.ts";

export type ExecutionDestination = "current" | "clipboard" | "tmux-current" | "tmux-pane" | "tmux-window";
export type PaneDirection = "below" | "right";
export type ModelPolicy = "current" | "saved" | "choose";

export interface ModelCandidate {
	provider: string;
	model: string;
	thinkingLevels: ThinkingLevel[];
}

export interface ExecutionSettings {
	destination: ExecutionDestination;
	modelPolicy: ModelPolicy;
	provider?: string;
	model?: string;
	thinkingLevel?: ThinkingLevel;
	saveDefault: boolean;
	paneDirection: PaneDirection;
}

export interface ResolvedExecution {
	destination: ExecutionDestination;
	model?: ModelSnapshot;
	saveDefault: boolean;
	paneDirection: PaneDirection;
}

export type ResolveExecutionResult = { ok: true; value: ResolvedExecution } | { ok: false; error: string };

/** The tmux replacement handoff keeps execution in the focused pane without copying the planning transcript. */
export function defaultExecutionDestination(hasTmux: boolean): ExecutionDestination {
	return hasTmux ? "tmux-current" : "current";
}

/** Cycle a settings value in either direction while preserving one-value action rows. */
export function cycleExecutionSettingValue(values: readonly string[], current: string, direction: 1 | -1): string {
	if (values.length < 2) return current;
	const index = values.indexOf(current);
	return values[(index < 0 ? 0 : index + direction + values.length) % values.length]!;
}

/** Keep an identified row selected when conditional rows are rebuilt. */
export function retainSelectedExecutionRow(ids: readonly string[], selectedId: string): string {
	return ids.includes(selectedId) ? selectedId : ids[0] ?? "";
}

export function modelKey(model: Pick<ModelSnapshot, "provider" | "model">): string {
	return `${model.provider}\u0000${model.model}`;
}

export function candidateFor(candidates: ModelCandidate[], provider?: string, model?: string): ModelCandidate | undefined {
	return candidates.find((candidate) => candidate.provider === provider && candidate.model === model);
}

export function createExecutionSettings(current?: ModelSnapshot, destination: ExecutionDestination = "current", modelPolicy: ModelPolicy = "current"): ExecutionSettings {
	return {
		destination,
		modelPolicy,
		provider: current?.provider,
		model: current?.model,
		thinkingLevel: current?.thinkingLevel,
		saveDefault: false,
		paneDirection: "below",
	};
}

/** Resolve without side effects. Callers persist only after a successful choose-and-save execution. */
export function resolveExecutionSettings(settings: ExecutionSettings, current: ModelSnapshot | undefined, saved: ModelSnapshot | undefined, candidates: ModelCandidate[]): ResolveExecutionResult {
	if (settings.destination === "clipboard") return { ok: true, value: { destination: "clipboard", saveDefault: false, paneDirection: "below" } };
	const selected = settings.modelPolicy === "current" ? current : settings.modelPolicy === "saved" ? saved : chooseSnapshot(settings, candidates);
	if (!selected) return { ok: false, error: settings.modelPolicy === "saved" ? "The saved plan execution default is invalid or unavailable." : "Select an available execution provider, model, and thinking level." };
	const candidate = candidateFor(candidates, selected.provider, selected.model);
	if (!candidate || !candidate.thinkingLevels.includes(selected.thinkingLevel)) return { ok: false, error: `Execution model ${selected.provider}/${selected.model} is unavailable.` };
	return { ok: true, value: { destination: settings.destination, model: selected, saveDefault: settings.modelPolicy === "choose" && settings.saveDefault, paneDirection: settings.paneDirection } };
}

function chooseSnapshot(settings: ExecutionSettings, candidates: ModelCandidate[]): ModelSnapshot | undefined {
	const candidate = candidateFor(candidates, settings.provider, settings.model);
	if (!candidate || !settings.thinkingLevel || !candidate.thinkingLevels.includes(settings.thinkingLevel)) return undefined;
	return { provider: candidate.provider, model: candidate.model, thinkingLevel: settings.thinkingLevel };
}
