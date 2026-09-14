export type ToolListParseResult =
	| { status: "absent" }
	| { status: "valid"; tools: string[] }
	| { status: "invalid"; error: string };

/** Preserve absent, explicitly empty, and malformed tool policies as distinct states. */
export function parseToolList(value: unknown): ToolListParseResult {
	if (value === undefined) return { status: "absent" };
	const values = typeof value === "string" ? value.split(",") : Array.isArray(value) ? value : undefined;
	if (!values || values.some((item) => typeof item !== "string")) {
		return { status: "invalid", error: "tools must be a comma-delimited string or an array of strings" };
	}
	return { status: "valid", tools: [...new Set(values.map((item) => item.trim()).filter(Boolean))] };
}
