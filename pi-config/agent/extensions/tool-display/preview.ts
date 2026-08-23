/** Limit logical result lines without changing their content or display width. */
export function previewResult(text: string, maxLines: number, expanded: boolean): { body: string; remaining: number } {
	const lines = text.split("\n");
	const shown = expanded ? lines : lines.slice(0, Math.max(1, maxLines));
	return {
		body: shown.join("\n"),
		remaining: Math.max(0, lines.length - shown.length),
	};
}
