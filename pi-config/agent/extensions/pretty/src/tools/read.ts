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
import { areToolResultsExpanded, RESULT_TOGGLE_HINT } from "../../../tool-display/state.js";
import { frameDivider, framePadding, frameRow, frameRows, frameText } from "../../../tool-display/frame.js";

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
				text.setText(fillToolBackground(renderToolError(getText(result) || "Error", theme), BG_ERROR));
				return text;
			}

			const d = result.details as ReadDetails | undefined;

			// Image content is preserved for ToolExecution's host-generic image pass.
			// Keep the SDK's text note visible as a fallback when host images are hidden
			// or unsupported by the terminal.
			if (d?._type === "readImage") {
				const note = getText(result);
				text.setText(note ? fillToolBackground(note, BG_BASE) : "");
				return text;
			}

			// File content — line-numbered display
			if (d?._type === "readFile" && d.content) {
				const tw = termWidth();
				const lines = d.content.split("\n");
				const total = lines.length;
				const filePath = String(d.filePath ?? "");
				const skillName = getSkillName(filePath, d.content);
				if (!areToolResultsExpanded()) {
					const previewCount = Math.min(total, 3);
					const width = Math.max(1, tw - 7);
					const preview = lines.slice(0, previewCount).map((line, index) => {
						const lineNo = String((d.offset || 0) + index + 1).padStart(3, " ");
						const code = line.length > width ? `${line.slice(0, Math.max(0, width - 1))}${FG_DIM}›${RST}` : line;
						return `${TOOL_RESULT_INDENT}${FG_LNUM}${lineNo}${RST} ${FG_RULE}│${RST} ${code}`;
					});
					const more = total > previewCount ? `\n${TOOL_RESULT_INDENT}${FG_DIM}… ${total - previewCount} more lines — ${RESULT_TOGGLE_HINT}${RST}` : "";
					const summary = `${theme.fg("success", "✓")} ${FG_DIM}${total} lines${RST}`;
					const rows = preview.map((line) => line);
					if (more) rows.push(more.trimStart());
					return frameText(text, (width) => [
						frameDivider(theme, BG_BASE, width),
						frameRow(summary, BG_BASE, width),
						...rows.map((line) => frameRow(line, BG_BASE, width)),
						framePadding(BG_BASE, width),
					].join("\n"));
				}
				const maxShow = lines.length;
				const show = lines.slice(0, maxShow);
				const nw = Math.max(3, String((d.offset || 0) + total).length);
				const gw = nw + 3;
				const cw = Math.max(1, tw - gw);

				const header = skillName ? `${TOOL_RESULT_INDENT}${renderSkillHeader(skillName, true, theme)}` : "";
				const out: string[] = [renderToolResultDivider(theme, tw), ...(header ? ["", header] : [])];
				out.push(`${TOOL_RESULT_INDENT}${FG_RULE}${"─".repeat(tw - 1)}${RST}`);
				for (let i = 0; i < show.length; i++) {
					const ln = (d.offset || 0) + i + 1;
					const code = show[i] ?? "";
					const display = code.length > cw ? code.slice(0, Math.max(0, cw - 1)) + `${FG_DIM}›${RST}` : code;
					const lineNo = String(ln);
					out.push(
						`${TOOL_RESULT_INDENT}${FG_LNUM}${" ".repeat(Math.max(0, nw - lineNo.length))}${lineNo}${RST} ${FG_RULE}│${RST} ${display}${RST}`,
					);
				}
				if (total > maxShow) {
					out.push(`${TOOL_RESULT_INDENT}${FG_DIM}… ${total - maxShow} more lines (${total} total)${RST}`);
				}
				out.push("");
				const rendered = out.join("\n");
				text.setText(fillToolBackground(rendered, BG_BASE));
				(ctx as any).state._rt = rendered;

				// Async syntax highlighting via Shiki
				renderFileContent(d.content, d.filePath, d.offset || 0, maxShow, cw, theme)
					.then((hl) => {
						const padded = hl
							.split("\n")
							.map((line, index) => {
								const lineNo = String((d.offset || 0) + index + 1);
								return `${TOOL_RESULT_INDENT}${FG_LNUM}${" ".repeat(Math.max(0, nw - lineNo.length))}${lineNo}${RST} ${FG_RULE}│${RST} ${line}${RST}`;
							})
							.join("\n");
						const divider = skillName
							? `${TOOL_RESULT_INDENT}${FG_RULE}${"─".repeat(Math.max(1, tw - 1))}${RST}\n`
							: "";
						const rendered = `\n${header}\n${divider}${padded}\n`;
						text.setText(fillToolBackground(rendered, BG_BASE));
						(ctx as any).state._rt = rendered;
					})
					.catch(() => {});

				return text;
			}

			const fc = result.content?.[0];
			text.setText(
				fillToolBackground(
					`${TOOL_RESULT_INDENT}${theme.fg("dim", fc && "text" in fc ? String(fc.text).slice(0, 120) : "done")}`,
					BG_BASE,
				),
			);
			return text;
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
