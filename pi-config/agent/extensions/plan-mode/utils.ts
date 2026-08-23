/**
 * Pure utility functions for plan mode.
 * Extracted for testability.
 */

export interface TodoItem {
	/** Stable internal identity; display numbering can change after plan edits. */
	id: string;
	step: number;
	text: string;
	completed: boolean;
	/** Step turned out unnecessary; treated as terminal like `completed` but rendered distinctly. */
	skipped: boolean;
}

export function cleanStepText(text: string): string {
	let cleaned = text
		.replace(/\*{1,2}([^*]+)\*{1,2}/g, "$1") // Remove bold/italic
		.replace(/`([^`]+)`/g, "$1") // Remove code
		.replace(
			/^(Use|Run|Execute|Create|Write|Read|Check|Verify|Update|Modify|Add|Remove|Delete|Install)\s+(the\s+)?/i,
			"",
		)
		.replace(/\s+/g, " ")
		.trim();

	if (cleaned.length > 0) {
		cleaned = cleaned.charAt(0).toUpperCase() + cleaned.slice(1);
	}
	return cleaned;
}

export function extractTodoItems(message: string): TodoItem[] {
	const items: TodoItem[] = [];
	const headerMatch = message.match(/(?:\*{0,2}Plan:\*{0,2}|##\s*Plan)\s*\n/i);
	if (!headerMatch) return items;

	const planSection = message.slice(message.indexOf(headerMatch[0]) + headerMatch[0].length);
	const numberedPattern = /^\s*(\d+)[.)]\s+\*{0,2}([^*\n]+)/gm;

	for (const match of planSection.matchAll(numberedPattern)) {
		const text = match[2]
			.trim()
			.replace(/\*{1,2}$/, "")
			.trim();
		if (text.length > 5 && !text.startsWith("`") && !text.startsWith("/") && !text.startsWith("-")) {
			const cleaned = cleanStepText(text);
			if (cleaned.length > 3) {
				items.push({ id: `extracted-${items.length + 1}`, step: items.length + 1, text: cleaned, completed: false, skipped: false });
			}
		}
	}
	return items;
}

/**
 * Parse the plain-text plan a user typed into the `/plan-edit` editor
 * (`N. step text` per line, numbering optional/ignored) back into step texts.
 */
export function parsePlanEditText(text: string): string[] {
	return text
		.split("\n")
		.map((line) => line.replace(/^\s*\d+[.)]\s*/, "").trim())
		.filter((line) => line.length > 0);
}

/**
 * Rebuild the todo list from edited step texts, preserving completed/skipped
 * flags for steps whose text is unchanged (case-insensitive, trimmed match).
 * New/reworded steps start incomplete; removed steps are dropped.
 */
export function mergePlanSteps(existing: TodoItem[], newTexts: string[]): TodoItem[] {
	const byText = new Map(existing.map((t) => [t.text.trim().toLowerCase(), t]));
	return newTexts.map((text, i) => {
		const prev = byText.get(text.trim().toLowerCase());
		return {
			id: prev?.id ?? `edited-${i + 1}`,
			step: i + 1,
			text,
			completed: prev?.completed ?? false,
			skipped: prev?.skipped ?? false,
		};
	});
}
