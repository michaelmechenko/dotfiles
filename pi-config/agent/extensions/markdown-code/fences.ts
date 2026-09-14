export type FenceLanguage = "javascript" | "typescript" | "python" | "bash" | "json";

export interface MarkdownFence {
	openingLine: number;
	closingLine?: number;
	bodyStartLine: number;
	bodyEndLine: number;
	prefix: string;
	marker: "`" | "~";
	markerLength: number;
	explicitLanguage?: string;
	language?: string;
	closed: boolean;
}

interface ParsedFenceLine {
	prefix: string;
	containerDepth: number;
	indentLength: number;
	marker: "`" | "~";
	markerLength: number;
	info: string;
}

const EXPLICIT_LANGUAGE_ALIASES: Record<string, string> = {
	js: "javascript",
	jsx: "javascript",
	ts: "typescript",
	tsx: "typescript",
	py: "python",
	sh: "bash",
	shell: "bash",
	zsh: "bash",
};

function splitLines(markdown: string): { lines: string[]; separators: string[] } {
	const lines: string[] = [];
	const separators: string[] = [];
	let start = 0;
	for (const match of markdown.matchAll(/\r?\n/g)) {
		lines.push(markdown.slice(start, match.index));
		separators.push(match[0]);
		start = (match.index ?? 0) + match[0].length;
	}
	lines.push(markdown.slice(start));
	return { lines, separators };
}

function joinLines(lines: readonly string[], separators: readonly string[]): string {
	let output = "";
	for (let index = 0; index < lines.length; index++) {
		output += lines[index] ?? "";
		if (index < separators.length) output += separators[index];
	}
	return output;
}

function containerPrefix(line: string): { prefix: string; rest: string } {
	let offset = 0;
	while (offset < line.length) {
		const match = /^( {0,3}>[ \t]?)/.exec(line.slice(offset));
		if (!match) break;
		offset += match[0].length;
	}
	return { prefix: line.slice(0, offset), rest: line.slice(offset) };
}

function parseFenceLine(line: string): ParsedFenceLine | undefined {
	const container = containerPrefix(line);
	const match = /^( {0,3})(`{3,}|~{3,})([^\r\n]*)$/.exec(container.rest);
	if (!match) return undefined;
	const marker = match[2]![0] as "`" | "~";
	return {
		prefix: container.prefix + match[1],
		containerDepth: (container.prefix.match(/>/g) ?? []).length,
		indentLength: match[1]!.length,
		marker,
		markerLength: match[2]!.length,
		info: match[3]!.trim(),
	};
}

function explicitLanguage(info: string): string | undefined {
	const token = info.split(/\s+/, 1)[0]?.trim().toLowerCase();
	if (!token) return undefined;
	return EXPLICIT_LANGUAGE_ALIASES[token] ?? token;
}

function stripContainer(line: string): string {
	return containerPrefix(line).rest;
}

function nestedListIndent(lines: readonly string[], openingLine: number, opening: ParsedFenceLine): number {
	if (opening.containerDepth > 0 || opening.indentLength === 0) return 0;
	for (let lineIndex = openingLine - 1; lineIndex >= 0; lineIndex--) {
		const line = lines[lineIndex]!;
		if (!line.trim()) continue;
		const list = /^( *)(?:[-+*]|\d+[.)])\s+/.exec(line);
		if (!list) {
			if (line.length - line.trimStart().length < opening.indentLength) return 0;
			continue;
		}
		const contentIndent = list[0]!.length;
		return opening.indentLength >= contentIndent ? opening.indentLength : 0;
	}
	return 0;
}

function isClosingFence(parsed: ParsedFenceLine | undefined, opening: ParsedFenceLine, minimumIndent: number): boolean {
	return Boolean(parsed && !parsed.info && parsed.containerDepth === opening.containerDepth && parsed.indentLength >= minimumIndent && parsed.marker === opening.marker && parsed.markerLength >= opening.markerLength);
}

/** Infer only languages with strong, deterministic syntax cues. Ambiguous content stays plain. */
export function inferFenceLanguage(code: string): FenceLanguage | undefined {
	const normalized = code.replace(/\r\n?/g, "\n");
	const trimmed = normalized.trim();
	if (!trimmed) return undefined;

	if ((trimmed.startsWith("{") && trimmed.endsWith("}")) || (trimmed.startsWith("[") && trimmed.endsWith("]"))) {
		try {
			JSON.parse(trimmed);
			return "json";
		} catch {}
	}

	if (/^\s*(?:interface\s+\w+|type\s+\w+\s*=|(?:const|let|var)\s+\w+\s*:\s*[A-Za-z_$]|(?:export\s+)?(?:abstract\s+)?class\s+\w+[^\n{]*\bimplements\b)/m.test(normalized)) return "typescript";
	if (/^\s*(?:const|let|var)\s+[A-Za-z_$][\w$]*\s*=|^\s*(?:export\s+)?(?:async\s+)?function\s+[A-Za-z_$][\w$]*\s*\(|\bconsole\.(?:log|warn|error)\s*\(/m.test(normalized)) return "javascript";
	if (/^\s*(?:async\s+def|def|class)\s+[A-Za-z_]\w*.*:\s*$|^\s*(?:from\s+[\w.]+\s+import|import\s+[A-Za-z_]\w*)\s*$|^\s*if\s+__name__\s*==\s*["']__main__["']\s*:/m.test(normalized)) return "python";
	if (/^#!.*\b(?:ba|z|k)?sh\b|^\s*set\s+-[a-zA-Z]*[eEuox]|^\s*(?:export\s+)?[A-Za-z_][A-Za-z0-9_]*=\S+/m.test(normalized)) return "bash";
	return undefined;
}

export function scanMarkdownFences(markdown: string): MarkdownFence[] {
	const { lines } = splitLines(markdown);
	const fences: MarkdownFence[] = [];
	for (let lineIndex = 0; lineIndex < lines.length; lineIndex++) {
		const opening = parseFenceLine(lines[lineIndex]!);
		if (!opening) continue;
		const explicit = explicitLanguage(opening.info);
		const minimumClosingIndent = nestedListIndent(lines, lineIndex, opening);
		let closingLine: number | undefined;
		for (let candidate = lineIndex + 1; candidate < lines.length; candidate++) {
			if (isClosingFence(parseFenceLine(lines[candidate]!), opening, minimumClosingIndent)) {
				closingLine = candidate;
				break;
			}
		}
		const bodyEndLine = closingLine ?? lines.length;
		const body = lines.slice(lineIndex + 1, bodyEndLine).map(stripContainer).join("\n");
		fences.push({
			openingLine: lineIndex,
			closingLine,
			bodyStartLine: lineIndex + 1,
			bodyEndLine,
			prefix: opening.prefix,
			marker: opening.marker,
			markerLength: opening.markerLength,
			explicitLanguage: explicit,
			language: explicit ?? inferFenceLanguage(body),
			closed: closingLine !== undefined,
		});
		lineIndex = closingLine ?? lines.length;
	}
	return fences;
}

/** Add display-only language hints to recognizable bare fences. */
export function transformFencedMarkdown(markdown: string): string {
	const { lines, separators } = splitLines(markdown);
	for (const fence of scanMarkdownFences(markdown)) {
		if (fence.explicitLanguage || !fence.language) continue;
		lines[fence.openingLine] = `${lines[fence.openingLine]}${fence.language}`;
	}
	return joinLines(lines, separators);
}
