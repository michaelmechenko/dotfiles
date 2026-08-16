/** Normalize the two supported YAML spellings for an agent tool allowlist. */
export function parseToolList(value: unknown): string[] | undefined {
	const values = Array.isArray(value) ? value : typeof value === "string" ? value.split(",") : [];
	const tools = values.filter((item): item is string => typeof item === "string").map((item) => item.trim()).filter(Boolean);
	return tools.length ? tools : undefined;
}
