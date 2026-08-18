export interface EditOperation { oldText: string; newText: string; }

/** Normalize current array edits and the extension's legacy top-level shape. */
export function normalizeEditOperations(input: unknown): EditOperation[] {
	if (!input || typeof input !== "object") return [];
	const value = input as Record<string, unknown>;
	const normalize = (edit: Record<string, unknown>): EditOperation => ({
		oldText: typeof edit.oldText === "string" ? edit.oldText : typeof edit.old_text === "string" ? edit.old_text : "",
		newText: typeof edit.newText === "string" ? edit.newText : typeof edit.new_text === "string" ? edit.new_text : "",
	});
	const edits = Array.isArray(value.edits) ? value.edits.filter((edit): edit is Record<string, unknown> => Boolean(edit) && typeof edit === "object").map(normalize) : [normalize(value)];
	return edits.filter((edit) => edit.oldText.length > 0 && edit.oldText !== edit.newText);
}
