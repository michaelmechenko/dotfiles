/**
 * pi-pretty: rendering functions for all tools.
 *
 * These produce ANSI-colored terminal output strings.
 * They are async only when Shiki syntax highlighting is involved.
 */

import { basename, dirname } from "node:path";
import type { AgentToolResult } from "@earendil-works/pi-coding-agent";
// Top-level value import so jiti's pi-tui alias applies (it only rewrites
// static top-level import/require, not function-body require — see tui-text.ts).
import { Text as TuiText, truncateToWidth } from "@earendil-works/pi-tui";
import { codeToANSI } from "@shikijs/cli";
import { bundledThemes } from "shiki";
import type { BundledLanguage, BundledTheme } from "shiki";
import {
	BG_BASE,
	BG_ERROR,
	CACHE_LIMIT,
	detectLang,
	dirIcon,
	FG_BLUE,
	FG_DIM,
	FG_LNUM,
	FG_RULE,
	FG_YELLOW,
	MAX_HL_CHARS,
	MAX_PREVIEW_LINES,
	RST,
	resolveBaseBackground,
	TOOL_RESULT_INDENT,
	termWidth,
} from "./config.js";
import {
	CHARS_KEY,
	compactErrorLines,
	ELAPSED_KEY,
	formatCharCount,
	formatElapsedMs,
	normalizeLineEndings,
} from "./helpers.js";
import type { RenderCtxLike as RenderContext, ThemeLike } from "./types.js";
import { frameResult, frameText } from "../../tool-display/frame.js";

/** Thin wrapper over pi-tui's truncateToWidth (imported at top level above). */
function _truncateToWidth(text: string, maxWidth: number, ellipsis?: string, pad?: boolean): string {
	return truncateToWidth(text, maxWidth, ellipsis, pad);
}

// ---------------------------------------------------------------------------
// Shiki ANSI cache
// ---------------------------------------------------------------------------

const DEFAULT_THEME: BundledTheme = "github-dark";

/**
 * pi's own theme names (e.g. "vague") are semantic-token themes, not Shiki
 * TextMate themes — Shiki has no bundled theme by that name and throws if
 * asked for one. Only accept a settings `theme` value that's an actual
 * Shiki-known theme; otherwise fall back to DEFAULT_THEME explicitly rather
 * than relying on hlBlock's try/catch to paper over an invalid theme string
 * (which silently disables all syntax highlighting, not just markdown).
 */
function resolveTheme(): BundledTheme {
	const env = process.env.PRETTY_THEME as BundledTheme | undefined;
	if (env && env in bundledThemes) return env;
	try {
		const home = process.env.HOME;
		const agentDir = process.env.PI_CODING_AGENT_DIR ?? (home ? require("node:path").join(home, ".pi/agent") : undefined);
		if (!agentDir) return DEFAULT_THEME;
		const settings = JSON.parse(require("node:fs").readFileSync(require("node:path").join(agentDir, "settings.json"), "utf8"));
		const themeName = settings.theme as string | undefined;
		return themeName && themeName in bundledThemes ? (themeName as BundledTheme) : DEFAULT_THEME;
	} catch {
		return DEFAULT_THEME;
	}
}

const THEME: BundledTheme = resolveTheme();
const _cache = new Map<string, string[]>();

function _touch(k: string, v: string[]): string[] {
	_cache.delete(k);
	_cache.set(k, v);
	while (_cache.size > CACHE_LIMIT) {
		const first = _cache.keys().next().value;
		if (first === undefined) break;
		_cache.delete(first);
	}
	return v;
}

async function hlBlock(code: string, language: BundledLanguage | undefined): Promise<string[]> {
	if (!code) return [""];
	if (!language || code.length > MAX_HL_CHARS) return code.split("\n");

	const k = `${THEME}\0${language}\0${code}`;
	const hit = _cache.get(k);
	if (hit) return _touch(k, hit);

	try {
		const ansi = normalizeShikiContrast(await codeToANSI(code, language, THEME));
		const out = (ansi.endsWith("\n") ? ansi.slice(0, -1) : ansi).split("\n");
		return _touch(k, out);
	} catch {
		return code.split("\n");
	}
}

const ESC_RE = "\u001b";
const ANSI_CAPTURE_RE = new RegExp(`${ESC_RE}\\[([0-9;]*)m`, "g");
const FG_MUTED = "\x1b[38;2;139;148;158m";

export function isLowContrastShikiFg(params: string): boolean {
	if (params === "30" || params === "90") return true;
	if (params === "38;5;0" || params === "38;5;8") return true;
	if (!params.startsWith("38;2;")) return false;
	const parts = params.split(";").map(Number);
	if (parts.length !== 5 || parts.some((n) => !Number.isFinite(n))) return false;
	const [, , r, g, b] = parts;
	const luminance = 0.2126 * r + 0.7152 * g + 0.0722 * b;
	return luminance < 72;
}

function normalizeShikiContrast(ansi: string): string {
	return ansi.replace(ANSI_CAPTURE_RE, (seq, params: string) => (isLowContrastShikiFg(params) ? FG_MUTED : seq));
}

// ---------------------------------------------------------------------------
// Box background helpers
// ---------------------------------------------------------------------------

export const RESET_WITHOUT_BG = "\x1b[22;23;24;25;27;28;29;39m";

export function preserveBoxBackground(ansi: string): string {
	return ansi.replace(ANSI_CAPTURE_RE, (_seq, params: string) => {
		if (!params || params === "0") return RESET_WITHOUT_BG;
		const parts = params.split(";").filter(Boolean);
		const kept: string[] = [];
		let i = 0;
		while (i < parts.length) {
			const code = Number(parts[i]);
			if (code === 38) {
				// Foreground extended — keep entire sequence
				kept.push(parts[i]);
				if (parts[i + 1] === "5") {
					kept.push(parts[i + 1]);
					i += 2;
				} else if (parts[i + 1] === "2") {
					kept.push(parts[i + 1], parts[i + 2], parts[i + 3], parts[i + 4]);
					i += 5;
				} else {
					i++;
				}
			} else if (code === 48) {
				// Background extended — skip entirely
				if (parts[i + 1] === "5") i += 3;
				else if (parts[i + 1] === "2") i += 6;
				else i++;
			} else if (code === 49 || (code >= 40 && code <= 47) || (code >= 100 && code <= 107)) {
				i++;
			} else {
				kept.push(parts[i]);
				i++;
			}
		}
		return kept.length ? `\x1b[${kept.join(";")}m` : "";
	});
}

export function fillToolBackground(text: string, bg = BG_BASE, width?: number): string {
	const renderWidth = width ?? termWidth();
	return text
		.split("\n")
		.map((line) => {
			const fitted = _truncateToWidth(line, renderWidth, "", true);
			const stripped = preserveBoxBackground(fitted);
			return bg ? bg + stripped : stripped;
		})
		.join("\n");
}

function lnum(n: number, w: number): string {
	const v = String(n);
	return `${FG_LNUM}${" ".repeat(Math.max(0, w - v.length))}${v}${RST}`;
}

// ---------------------------------------------------------------------------
// Tool metrics line
// ---------------------------------------------------------------------------

export function renderToolMetrics(result: AgentToolResult<Record<string, unknown>>): string {
	const details = result.details as Record<string, unknown> | undefined;
	if (!details) return "";
	const elapsed = formatElapsedMs(details[ELAPSED_KEY] as number | undefined);
	const chars = formatCharCount(details[CHARS_KEY] as number | undefined);
	if (!elapsed && !chars) return "";
	return `${FG_DIM}· ${[elapsed, chars].filter(Boolean).join(" · ")}${RST}`;
}

export function renderToolDuration(result: AgentToolResult<Record<string, unknown>>): string {
	const details = result.details as Record<string, unknown> | undefined;
	return formatElapsedMs(details?.[ELAPSED_KEY] as number | undefined);
}

// ---------------------------------------------------------------------------
// Card framing — status icon + title + duration
// ---------------------------------------------------------------------------

export type CardStatus = "success" | "error" | "pending";

function cardStatusIcon(status: CardStatus | undefined, theme: ThemeLike): string {
	if (status === "error") return theme.fg("error", "✗");
	if (status === "pending") return theme.fg("warning", "○");
	return theme.fg("success", "✓");
}

/**
 * Card header: status icon + title + optional dim duration. `title` should
 * already carry any theme coloring the caller wants (bold/toolTitle).
 */
export function renderCardHeader(opts: {
	title: string;
	status?: CardStatus;
	duration?: string;
	theme: ThemeLike;
}): string {
	return `${TOOL_RESULT_INDENT}${renderFrameStatus(opts)}`;
}

/** Frame content has no outer indent; frameRow() owns it. */
export function renderFrameStatus(opts: {
	title: string;
	status?: CardStatus;
	duration?: string;
	theme: ThemeLike;
}): string {
	const { title, status, duration, theme } = opts;
	const icon = cardStatusIcon(status, theme);
	const durationPart = duration ? ` ${theme.fg("dim", `· ${duration}`)}` : "";
	return `${icon} ${title}${durationPart}`;
}

/** Neutral call header inside the semantic result card. */
export function fillToolCallBackground(text: string, theme: ThemeLike, width?: number): string {
	return fillToolBackground(text, theme.getBgAnsi?.("toolSuccessBg") ?? "", width);
}

/** Visual boundary between a tool invocation and its returned data. */
export function renderToolResultDivider(theme: ThemeLike, width: number): string {
	return `${TOOL_RESULT_INDENT}${theme.fg("dim", "─".repeat(Math.max(1, width - 2)))}${TOOL_RESULT_INDENT}`;
}

// ---------------------------------------------------------------------------
// Error renderer
// ---------------------------------------------------------------------------

export function renderToolError(error: string, theme: ThemeLike): string {
	const body = compactErrorLines(error)
		.map((line) => `${TOOL_RESULT_INDENT}${line ? theme.fg("error", line) : ""}`)
		.join("\n");
	return fillToolBackground(body, BG_ERROR);
}

// ---------------------------------------------------------------------------
// Markdown — rendered via theme tokens, not Shiki
// ---------------------------------------------------------------------------

// Shiki has no bundled theme matching pi's own semantic theme (e.g. "vague"),
// so it can never render markdown headings/quotes/etc. in the active
// palette's colors — at best it falls back to an arbitrary bundled theme
// (see resolveTheme() above). Markdown gets its own lightweight renderer that
// goes straight through the active theme's `md*` tokens (documented in
// COLORS.md's "pi coding agent integration" section), guaranteeing headings,
// quotes, links, and inline code always match the rest of the UI.
const MD_HEADING_RE = /^(#{1,6})(\s+)(.*)$/;
const MD_QUOTE_RE = /^(\s*>\s?)(.*)$/;
const MD_LIST_RE = /^(\s*)([-*+]|\d+[.)])(\s+)(.*)$/;
const MD_HR_RE = /^\s*(-{3,}|\*{3,}|_{3,})\s*$/;
const MD_FENCE_RE = /^\s*```/;
const MD_LINK_RE = /\[([^\]]*)\]\([^)]*\)/g;
const MD_INLINE_CODE_RE = /`([^`]+)`/g;
const MD_BOLD_RE = /\*\*([^*]+)\*\*/g;

function renderMarkdownInline(text: string, theme: ThemeLike): string {
	return text
		.replace(MD_LINK_RE, (_m, label) => theme.fg("mdLink", label || ""))
		.replace(MD_INLINE_CODE_RE, (_m, code) => theme.fg("mdCode", code))
		.replace(MD_BOLD_RE, (_m, inner) => theme.bold(inner));
}

export function renderMarkdownBlock(code: string, theme: ThemeLike): string[] {
	return code.split("\n").map((line) => {
		const heading = line.match(MD_HEADING_RE);
		if (heading) {
			return theme.fg("mdHeading", theme.bold(`${heading[1]}${heading[2]}${renderMarkdownInline(heading[3], theme)}`));
		}
		const quote = line.match(MD_QUOTE_RE);
		if (quote) {
			return theme.fg("mdQuoteBorder", quote[1]) + theme.fg("mdQuote", renderMarkdownInline(quote[2], theme));
		}
		const list = line.match(MD_LIST_RE);
		if (list) {
			return `${list[1]}${theme.fg("mdListBullet", list[2])}${list[3]}${renderMarkdownInline(list[4], theme)}`;
		}
		if (MD_FENCE_RE.test(line)) return theme.fg("mdCodeBlockBorder", line);
		if (MD_HR_RE.test(line)) return theme.fg("mdHr", line);
		return renderMarkdownInline(line, theme);
	});
}

// ---------------------------------------------------------------------------
// Read — syntax-highlighted file content
// ---------------------------------------------------------------------------

export async function renderFileContent(
	content: string,
	filePath: string,
	offset = 0,
	maxLines = MAX_PREVIEW_LINES,
	width?: number,
	theme?: ThemeLike,
): Promise<string> {
	const normalizedContent = normalizeLineEndings(content);
	const lines = normalizedContent.split("\n");
	const show = lines.slice(0, maxLines);
	const lg = detectLang(filePath);
	const hl = theme && (lg === "markdown" || lg === "mdx") ? renderMarkdownBlock(show.join("\n"), theme) : await hlBlock(show.join("\n"), lg);

	const tw = width ?? termWidth();

	const out: string[] = [];
	for (const line of hl) {
		out.push(_truncateToWidth(line ?? "", Math.max(1, tw), `${FG_DIM}›`));
	}
	return out.join("\n");
}

// ---------------------------------------------------------------------------
// Bash — colored exit status
// ---------------------------------------------------------------------------

export function renderBashOutput(text: string): string {
	const lines = text.split("\n");
	const maxShow = MAX_PREVIEW_LINES;
	const show = lines.slice(0, maxShow);
	const remaining = lines.length - maxShow;

	let body = show.join("\n");
	if (remaining > 0) body += `\n${TOOL_RESULT_INDENT}${FG_DIM}… ${remaining} more lines${RST}`;

	return body;
}

// ---------------------------------------------------------------------------
// Ls — tree view with icons
// ---------------------------------------------------------------------------

export function renderTree(text: string, _basePath: string): string {
	const lines = text.trim().split("\n").filter(Boolean);
	if (!lines.length) return `${FG_DIM}(empty directory)${RST}`;

	const out: string[] = [];
	const total = lines.length;
	const show = lines.slice(0, MAX_PREVIEW_LINES);

	for (let i = 0; i < show.length; i++) {
		const entry = show[i].trim();
		const isLast = i === show.length - 1 && total <= MAX_PREVIEW_LINES;
		const prefix = isLast ? "└── " : "├── ";
		const connector = `${FG_RULE}${prefix}${RST}`;
		const isDir = entry.endsWith("/");
		const name = isDir ? entry.slice(0, -1) : entry;
		const icon = isDir ? dirIcon() : "";
		out.push(`${connector}${icon}${isDir ? `${FG_BLUE}\x1b[1m${name}${RST}` : name}`);
	}

	if (total > MAX_PREVIEW_LINES) {
		out.push(`${FG_RULE}└── ${RST}${FG_DIM}… ${total - MAX_PREVIEW_LINES} more entries${RST}`);
	}

	return out.join("\n");
}

// ---------------------------------------------------------------------------
// Find — grouped file list (plain, no tree characters or icons)
// ---------------------------------------------------------------------------

export function renderFindResults(text: string, theme?: ThemeLike): string {
	const lines = text.trim().split("\n").filter(Boolean);
	if (!lines.length) return theme ? theme.fg("dim", "(no matches)") : `${FG_DIM}(no matches)${RST}`;

	const groups = new Map<string, string[]>();
	for (const line of lines) {
		const trimmed = line.trim();
		const dir = dirname(trimmed) || ".";
		const file = basename(trimmed);
		if (!groups.has(dir)) groups.set(dir, []);
		const bucket = groups.get(dir);
		if (bucket) bucket.push(file);
	}

	const out: string[] = [];
	let count = 0;

	for (const [dir, files] of groups) {
		if (count > 0) out.push("");
		const dirColored = theme ? theme.fg("accent", theme.bold(`${dir}/`)) : `${FG_BLUE}\x1b[1m${dir}/${RST}`;
		out.push(dirColored);
		for (let i = 0; i < files.length; i++) {
			if (count >= MAX_PREVIEW_LINES) {
				const more = theme
					? theme.fg("dim", `… ${lines.length - count} more files`)
					: `${FG_DIM}… ${lines.length - count} more files${RST}`;
				out.push(`${TOOL_RESULT_INDENT}${more}`);
				return out.join("\n");
			}
			out.push(`${TOOL_RESULT_INDENT}${files[i]}`);
			count++;
		}
	}

	return out.join("\n");
}

// ---------------------------------------------------------------------------
// Grep — highlighted matches with line numbers
// ---------------------------------------------------------------------------

export async function renderGrepResults(text: string, pattern: string): Promise<string> {
	const lines = normalizeLineEndings(text).split("\n");
	if (!lines.length || (lines.length === 1 && !lines[0].trim())) return `${FG_DIM}(no matches)${RST}`;

	const out: string[] = [];
	let currentFile = "";
	let count = 0;

	let re: RegExp | null = null;
	try {
		re = new RegExp(`(${pattern})`, "gi");
	} catch {
		/* skip highlighting */
	}

	for (const line of lines) {
		if (count >= MAX_PREVIEW_LINES) {
			out.push(`${FG_DIM}  … more matches${RST}`);
			break;
		}
		const fileMatch = line.match(/^(.+?)[:-](\d+)[:-](.*)$/);
		if (fileMatch) {
			const [, file, lineNo, content] = fileMatch;
			if (file !== currentFile) {
				if (currentFile) out.push("");
				out.push(`${FG_BLUE}\x1b[1m${file}${RST}`);
				currentFile = file;
			}
			const nw = Math.max(3, lineNo.length);
			let display = content;
			if (re) display = content.replace(re, `${RST}${FG_YELLOW}\x1b[1m$1${RST}`);
			out.push(`${TOOL_RESULT_INDENT}${lnum(Number(lineNo), nw)} ${FG_RULE}│${RST} ${display}${RST}`);
			count++;
		} else if (line.trim() === "--") {
			out.push(`${TOOL_RESULT_INDENT}${FG_DIM}  ···${RST}`);
		} else if (line.trim()) {
			out.push(line);
			count++;
		}
	}

	return out.join("\n");
}

// ---------------------------------------------------------------------------
// Generic renderCall / renderResult for custom tools
// ---------------------------------------------------------------------------

export function makeRenderCall(toolName: string) {
	return (args: Record<string, unknown>, theme: ThemeLike, ctx: RenderContext) => {
		resolveBaseBackground(theme);
		const text = ctx.lastComponent ?? new TuiText("", 0, 0);
		const bg = ctx.isError ? BG_ERROR : theme.getBgAnsi?.("toolPendingBg");
		return frameText(text, (width) => frameResult(theme, width, [theme.fg("toolTitle", theme.bold(toolName))], bg));
	};
}

export function makeRenderResult() {
	return (result: AgentToolResult<Record<string, unknown>>, _opt: unknown, theme: ThemeLike, ctx: RenderContext) => {
		resolveBaseBackground(theme);
		const text = ctx.lastComponent ?? new TuiText("", 0, 0);
		if (ctx.isError) {
			const message = (getTextContent(result) || "Error").split("\n").map((line) => theme.fg("error", line));
			return frameText(text, (width) => frameResult(theme, width, message, BG_ERROR));
		}
		const content = getTextContent(result);
		if (content) {
			const renderWidth = termWidth();
			const lines = content.split("\n");
			const maxShow = ctx.expanded ? lines.length : Math.min(lines.length, MAX_PREVIEW_LINES);
			const preview = lines.slice(0, maxShow).join("\n");
			const more = lines.length > maxShow ? `\n${FG_DIM}... ${lines.length - maxShow} more lines${RST}` : "";
			const metrics = renderToolMetrics(result);
			text.setText(frameResult(theme, renderWidth, [`${preview}${more}${metrics ? `\n${metrics}` : ""}`], undefined));
		} else {
			text.setText(frameResult(theme, termWidth(), [theme.fg("dim", "(no text output)")]));
		}
		return text;
	};
}

function getTextContent(result: AgentToolResult<Record<string, unknown>>): string {
	return (result.content ?? [])
		.filter((c: any) => c.type === "text")
		.map((c: any) => c.text ?? "")
		.join("\n");
}
