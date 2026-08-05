export function getTextContent(content: Array<{ type: string; text?: string }> | undefined): string {
	if (!content) return "";
	return content
		.filter((item): item is { type: "text"; text: string } => item.type === "text" && typeof item.text === "string")
		.map((item) => item.text)
		.join("\n");
}
