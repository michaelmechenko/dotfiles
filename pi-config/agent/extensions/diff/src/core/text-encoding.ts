/**
 * BOM and line-ending preservation for hashline file I/O (aligned with pi-mono edit tool).
 */

export type LineEnding = "\r\n" | "\n";

export function stripBom(content: string): { bom: string; text: string } {
	return content.startsWith("\uFEFF") ? { bom: "\uFEFF", text: content.slice(1) } : { bom: "", text: content };
}

export function detectLineEnding(content: string): LineEnding {
	const crlfIdx = content.indexOf("\r\n");
	const lfIdx = content.indexOf("\n");
	if (lfIdx === -1 || crlfIdx === -1) return "\n";
	return crlfIdx < lfIdx ? "\r\n" : "\n";
}

export function normalizeToLF(text: string): string {
	return text.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
}

export function restoreLineEndings(text: string, ending: LineEnding): string {
	return ending === "\r\n" ? text.replace(/\n/g, "\r\n") : text;
}

/** Strip BOM and normalize newlines for hashline matching; keep metadata for write-back. */
export function prepareTextForHashlineEdit(rawUtf8: string): {
	bom: string;
	ending: LineEnding;
	normalized: string;
} {
	const { bom, text } = stripBom(rawUtf8);
	const ending = detectLineEnding(text);
	const normalized = normalizeToLF(text);
	return { bom, ending, normalized };
}

export function finalizeHashlineWriteContent(bom: string, ending: LineEnding, lfContent: string): string {
	return bom + restoreLineEndings(lfContent, ending);
}
