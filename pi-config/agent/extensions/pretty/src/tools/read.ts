/* pi-pretty: read tool -- file reading with syntax highlighting and inline image support. */

import { basename, dirname } from "node:path";
import type { AgentToolResult, ExtensionAPI, ExtensionContext, ToolDefinition } from "@earendil-works/pi-coding-agent";
import {
	BG_BASE,
	BG_ERROR,
	FG_DIM,
	FG_LNUM,
	FG_RULE,
	RST,
	resolveBaseBackground,
	TOOL_RESULT_INDENT,
	termWidth,
} from "../config.js";
import { normalizeLineEndings, shortPath } from "../helpers.js";
import { fillToolBackground, fillToolCallBackground, renderFrameStatus, renderFileContent, renderToolError, renderToolResultDivider } from "../render.js";
import { resolveTextCtor } from "../tui-text.js";
import type { ReadDetails, RenderCtxLike, SdkToolDef, TextContent, ThemeLike } from "../types.js";
import { wrapExecuteWithMetrics } from "./metrics.js";
import { areToolOutputsWrapped } from "../../../tool-display/state.js";
import { cardEdgeColor, frameDivider, framePadding, frameResult, frameRow, frameRows, frameText, layoutToolText } from "../../../tool-display/frame.js";

type Result = AgentToolResult<Record<string, unknown>>;

function getSkillName(filePath: string, content: string): string | undefined {
	if (basename(filePath) !== "SKILL.md") return undefined;

	const lines = content.split("\n");
	if (lines[0]?.trim() === "---") {
		const end = lines.findIndex((line, index) => index > 0 && line.trim() === "---");
		for (const line of lines.slice(1, end < 0 ? 1 : end)) {
			const match = /^name\s*:\s*(.+?)\s*$/.exec(line);
			if (!match) continue;
			const value = match[1].trim();
			if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
				return value.slice(1, -1).trim() || basename(dirname(filePath));
			}
			return value || basename(dirname(filePath));
		}
	}

	return basename(dirname(filePath));
}

function renderSkillHeader(skillName: string, expanded: boolean, theme: ThemeLike): string {
	const label = theme.fg("accent", "[skill]");
	const name = theme.fg("toolTitle", skillName);
	const hint = theme.fg("dim", `ctrl+o to ${expanded ? "collapse" : "expand"}`);
	return `${label} ${name} ${hint}`;
}

export function registerReadTool(
	pi: ExtensionAPI,
	cwd: string,
	_fffService: unknown,
	sdkTool: SdkToolDef,
	TextComp?: new (t?: string, x?: number, y?: number) => { setText(v: string): void },
): void {
	const TC = resolveTextCtor(TextComp);
	const home = process.env.HOME ?? "";

	pi.registerTool({
		name: "read",
		label: "Read",
		description: sdkTool.description ?? "Read file contents",
		parameters: sdkTool.parameters,
		renderShell: "self",

		execute: wrapExecuteWithMetrics(async (tid, params, sig, _upd, ctx: ExtensionContext) => {
			const p = params as any;
			const result = (await sdkTool.execute(tid, p, sig, undefined, ctx)) as Result;

			const imageBlock = (result.content as any[])?.find((c: any) => c.type === "image");
			if (imageBlock) {
				result.details = {
					_type: "readImage",
					filePath: String(p.path ?? ""),
				} as ReadDetails;
				return result;
			}

			const tc = normalizeLineEndings(getText(result));
			result.details = {
				_type: "readFile",
				filePath: String(p.path ?? ""),
				content: tc,
				offset: typeof p.offset === "number" ? p.offset : 0,
				lineCount: tc ? tc.split("\n").length : 0,
			} as ReadDetails;
			return result;
		}),

		renderCall(args: any, theme: ThemeLike, ctx: RenderCtxLike) {
			resolveBaseBackground(theme);
			const text = ctx.lastComponent ?? new TC("", 0, 0);
			const path = shortPath(cwd, home, String(args.path ?? ""));
			const offset = typeof args.offset === "number" ? `:${args.offset}` : "";
			const limit = typeof args.limit === "number" ? ` +${args.limit}` : "";
			const title = `${theme.fg("toolTitle", theme.bold("read"))} ${theme.fg("toolTitle", path)}${theme.fg("dim", `${offset}${limit}`)}`;
			const header = renderFrameStatus({ title, status: ctx.isError ? "error" : "pending", theme });
			return frameText(text, (width) => frameRows(["", header], theme.getBgAnsi?.("toolSuccessBg"), width));
		},

		renderResult(result: Result, _opt: unknown, theme: ThemeLike, ctx: RenderCtxLike) {
			resolveBaseBackground(theme);

			const text = ctx.lastComponent ?? new TC("", 0, 0);

			if (ctx.isError) {
				const message = (getText(result) || "Error").split("\n").map((line) => theme.fg("error", line));
				return frameText(text, (width) => frameResult(theme, width, message, BG_ERROR, cardEdgeColor("error", theme)));
			}

			const d = result.details as ReadDetails | undefined;

			// Image content is preserved for ToolExecution's host-generic image pass.
			// Keep the SDK's text note visible as a fallback when host images are hidden
			// or unsupported by the terminal.
			if (d?._type === "readImage") {
				const note = getText(result);
				return frameText(text, (width) => note ? frameResult(theme, width, note.split("\n"), BG_BASE) : frameRows([], BG_BASE, width));
			}

			// File content — line-numbered display
			if (d?._type === "readFile" && d.content) {
				const tw = termWidth();
				const lines = d.content.split("\n");
				const total = lines.length;
				const filePath = String(d.filePath ?? "");
				const skillName = getSkillName(filePath, d.content);
				const textRecord = text as any;
				const highlightThemeKey = [
					"mdHeading", "mdLink", "mdCode", "mdCodeBlock", "mdCodeBlockBorder", "mdQuote", "mdQuoteBorder", "mdHr", "mdListBullet",
					"syntaxComment", "syntaxKeyword", "syntaxFunction", "syntaxVariable", "syntaxString", "syntaxNumber", "syntaxType", "syntaxOperator", "syntaxPunctuation",
				].map((token) => theme.fg(token, token)).join("\0");
				const highlightKey = `${filePath}\0${d.content}\0${highlightThemeKey}`;
				const requestHighlight = (onReady: () => void) => {
					if (textRecord.__prettyReadHighlightKey === highlightKey || textRecord.__prettyReadHighlightPending === highlightKey) return;
					textRecord.__prettyReadHighlightPending = highlightKey;
					renderFileContent(d.content, d.filePath, d.offset || 0, lines.length, 100_000, theme)
						.then((highlighted) => {
							if (textRecord.__prettyReadHighlightPending !== highlightKey) return;
							textRecord.__prettyReadHighlight = highlighted.split("\n");
							textRecord.__prettyReadHighlightKey = highlightKey;
							textRecord.__prettyReadHighlightPending = undefined;
							onReady();
							ctx.invalidate();
						})
						.catch(() => {
							if (textRecord.__prettyReadHighlightPending === highlightKey) textRecord.__prettyReadHighlightPending = undefined;
						});
				};
				if (!ctx.expanded) {
					const previewCount = Math.min(total, 3);
					const summary = `${theme.fg("success", "✓")} ${FG_DIM}${total} lines${RST}`;
					const buildCollapsed = (renderWidth: number) => {
						const codeWidth = Math.max(1, renderWidth - 8);
						const displayLines: string[] = textRecord.__prettyReadHighlight ?? lines;
						const rows = displayLines.slice(0, previewCount).flatMap((line, index) => {
							const lineNo = String((d.offset || 0) + index + 1).padStart(3, " ");
							const gutter = `${TOOL_RESULT_INDENT}${FG_LNUM}${lineNo}${RST} ${FG_RULE}│${RST} `;
							const continuation = `${TOOL_RESULT_INDENT}${FG_LNUM}   ${RST} ${FG_RULE}│${RST} `;
							return layoutToolText(line, codeWidth).map((segment, segmentIndex) => `${segmentIndex === 0 ? gutter : continuation}${segment}`);
						});
						if (total > previewCount) rows.push(`${TOOL_RESULT_INDENT}${FG_DIM}… ${total - previewCount} more lines — ctrl+o${RST}`);
						return [
							frameDivider(theme, BG_BASE, renderWidth),
							frameRow(summary, BG_BASE, renderWidth),
							...rows.map((line) => frameRow(line, BG_BASE, renderWidth)),
							framePadding(BG_BASE, renderWidth),
						].join("\n");
					};
					const framed = frameText(text, buildCollapsed);
					if (/\.(?:md|markdown|mdx)$/i.test(filePath)) {
						requestHighlight(() => {
							if (textRecord.__toolFrame) textRecord.__toolFrame.width = 0;
							textRecord.setText(buildCollapsed(termWidth()));
						});
					}
					return framed;
				}
				const maxShow = lines.length;
				const show = lines.slice(0, maxShow);
				const nw = Math.max(3, String((d.offset || 0) + total).length);
				const header = skillName ? `${TOOL_RESULT_INDENT}${renderSkillHeader(skillName, true, theme)}` : "";
				const buildPlain = (renderWidth: number) => {
					const codeWidth = Math.max(1, renderWidth - nw - 5);
					const out: string[] = [renderToolResultDivider(theme, renderWidth), ...(header ? ["", header] : [])];
					out.push(`${TOOL_RESULT_INDENT}${FG_RULE}${"─".repeat(Math.max(1, renderWidth - 1))}${RST}`);
					const displayLines: string[] = textRecord.__prettyReadHighlight ?? show;
					for (let i = 0; i < show.length; i++) {
						const ln = (d.offset || 0) + i + 1;
						const lineNo = String(ln);
						const gutter = `${TOOL_RESULT_INDENT}${FG_LNUM}${" ".repeat(Math.max(0, nw - lineNo.length))}${lineNo}${RST} ${FG_RULE}│${RST} `;
						const continuation = `${TOOL_RESULT_INDENT}${FG_LNUM}${" ".repeat(nw)}${RST} ${FG_RULE}│${RST} `;
						for (const [segmentIndex, segment] of layoutToolText(displayLines[i] ?? "", codeWidth).entries()) {
							out.push(`${segmentIndex === 0 ? gutter : continuation}${segment}${RST}`);
						}
					}
					out.push("");
					return frameRows(out.map((line) => (line.startsWith(" ") ? line.slice(1) : line)), BG_BASE, renderWidth);
				};
				const rendered = buildPlain(tw);
				text.setText(rendered);
				(ctx as any).state._rt = rendered;
				if (!textRecord.__prettyReadWidthAware && typeof textRecord.render === "function") {
					const baseRender = textRecord.render.bind(textRecord);
					textRecord.__prettyReadWidthAware = true;
					textRecord.__prettyReadRenderKey = "";
					textRecord.render = (width: number) => {
						const actual = Math.max(1, Math.floor(width || termWidth()));
						const key = `${actual}:${areToolOutputsWrapped() ? "wrap" : "clip"}`;
						if (key !== textRecord.__prettyReadRenderKey) {
							textRecord.setText(buildPlain(actual));
							textRecord.__prettyReadRenderKey = key;
						}
						return baseRender(width);
					};
				}

				// Highlight source lines at a deliberately wide width, then apply the
				// shared display policy on every render. This keeps the ANSI source
				// intact for both wrapping and one-row clipping modes.
				requestHighlight(() => {
					textRecord.__prettyReadRenderKey = "";
					textRecord.setText(buildPlain(termWidth()));
				});

				return text;
			}

			const fc = result.content?.[0];
			return frameText(text, (width) => frameResult(theme, width, [theme.fg("dim", fc && "text" in fc ? String(fc.text).slice(0, 120) : "done")], BG_BASE));
		},
	} as unknown as ToolDefinition<any, any, any>);
}

function getText(result: Result): string {
	return (
		((result.content ?? []) as TextContent[])
			.filter((c) => c.type === "text")
			.map((c) => c.text)
			.join("\n") ?? ""
	);
}
