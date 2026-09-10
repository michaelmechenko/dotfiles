import type { Theme } from "@earendil-works/pi-coding-agent";
import type { TodoItem } from "./utils.ts";

type TruncateToWidth = (text: string, width: number, ellipsis?: string) => string;

export const EXECUTION_SETTINGS_HELP = "↑↓ select • tab/right next • shift-tab/left previous • enter/space next • esc cancel";

export function renderExecutionSettingsHeader(theme: Pick<Theme, "bold" | "fg">, width: number, truncateToWidth: TruncateToWidth): string[] {
	return [
		truncateToWidth(theme.fg("accent", theme.bold("Execution settings")), width),
		truncateToWidth(theme.fg("dim", EXECUTION_SETTINGS_HELP), width),
		"",
	];
}

export function renderPlanProgress(theme: Pick<Theme, "fg">, steps: TodoItem[], selectedIndex: number, width: number, truncateToWidth: TruncateToWidth): string[] {
	return [
		truncateToWidth(theme.fg("accent", " Plan Progress "), width),
		...steps.map((step, index) => truncateToWidth(`${index === selectedIndex ? theme.fg("accent", " ❯ ") : "   "}${step.completed ? theme.fg("success", "[x] ") : step.skipped ? theme.fg("dim", "[-] ") : theme.fg("muted", "[ ] ")}${step.text}`, width)),
		truncateToWidth(theme.fg("dim", " ↑↓ navigate • space cycle status • esc close"), width),
	];
}
