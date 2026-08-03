import { previewResult, RESULT_TOGGLE_HINT } from "../tool-display/state.js";

export function getTextContent(content: Array<{ type: string; text?: string }> | undefined): string {
	if (!content) return "";
	return content
		.filter((item): item is { type: "text"; text: string } => item.type === "text" && typeof item.text === "string")
		.map((item) => item.text)
		.join("\n");
}

export function appendExpandedPreview(
	base: string,
	text: string,
	theme: { fg: (name: string, value: string) => string },
	options: { maxLines?: number } = {},
): string {
	const preview = previewResult(text, options.maxLines ?? 12);
	for (const line of preview.body.split("\n")) base += `\n${theme.fg("dim", line)}`;
	if (preview.remaining > 0) base += `\n${theme.fg("muted", `… ${preview.remaining} more lines (${RESULT_TOGGLE_HINT})`)}`;
	return base;
}

export function appendExpandHint(base: string): string {
	return base;
}
