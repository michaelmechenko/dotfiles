/* pi-pretty: find tool -- fd-backed file search via Pi's built-in SDK find tool. */

import type { AgentToolResult, ExtensionAPI, ExtensionContext, ToolDefinition } from "@earendil-works/pi-coding-agent";
import { BG_ERROR, FG_DIM, RST, resolveBaseBackground, TOOL_RESULT_INDENT } from "../config.js";
import { shortPath } from "../helpers.js";
import { fillToolBackground, fillToolCallBackground, renderFrameStatus, renderFindResults, renderToolDuration, renderToolError, renderToolResultDivider } from "../render.js";
import { resolveTextCtor } from "../tui-text.js";
import type { FindDetails, RenderCtxLike, SdkToolDef, TextContent, ThemeLike } from "../types.js";
import { wrapExecuteWithMetrics } from "./metrics.js";
import { areToolResultsExpanded, RESULT_TOGGLE_HINT } from "../../../tool-display/state.js";
import { frameDivider, framePadding, frameResult, frameRow, frameRows, frameText } from "../../../tool-display/frame.js";

type Result = AgentToolResult<Record<string, unknown>>;

function getText(result: Result): string {
	return (result.content ?? [])
		.filter((c) => c.type === "text")
		.map((c) => (c as TextContent).text ?? "")
		.join("\n");
}

export function registerFindTool(
	pi: ExtensionAPI,
	cwd: string,
	_fffService: unknown,
	sdkTool: SdkToolDef,
	TextComp?: new (t?: string, x?: number, y?: number) => { setText(v: string): void },
): void {
	const TC = resolveTextCtor(TextComp);
	const home = process.env.HOME ?? "";

	pi.registerTool({
		name: "find",
		label: "Find",
		description: sdkTool.description ?? "Find files matching a glob pattern",
		parameters: sdkTool.parameters,
		renderShell: "self",

		execute: wrapExecuteWithMetrics(async (tid, params, sig, _upd, ctx: ExtensionContext) => {
			const pattern = String(params.pattern ?? "");
			const result = (await sdkTool.execute(tid, params, sig, undefined, ctx)) as Result;
			const tc = getText(result);
			result.details = {
				_type: "findResult",
				text: tc,
				pattern,
				matchCount: tc ? tc.trim().split("\n").filter(Boolean).length : 0,
			};
			return result;
		}),

		renderCall(args: any, theme: ThemeLike, ctx: RenderCtxLike) {
			resolveBaseBackground(theme);
			const a = args as { pattern?: unknown; path?: unknown; limit?: unknown };
			const text = (ctx as RenderCtxLike).lastComponent ?? new TC("", 0, 0);
			const pattern = a.pattern == null ? "" : String(a.pattern);
			const pathArg = a.path == null ? "<missing>" : shortPath(cwd, home, String(a.path));
			const limit = a.limit;
			const findLabel = theme.fg("toolTitle", theme.bold("find"));
			const patternPart = pattern ? theme.fg("toolTitle", pattern) : "";
			const inPart = theme.fg("dim", " in ");
			const pathPart = theme.fg("toolOutput", pathArg);
			const limitPart = limit !== undefined && limit !== null ? theme.fg("dim", ` limit ${limit}`) : "";
			const title = `${findLabel} ${patternPart}${inPart}${pathPart}${limitPart}`;
			const headerLine = renderFrameStatus({ title, status: ctx.isError ? "error" : "pending", theme });
			return frameText(text, (width) => frameRows(["", headerLine], theme.getBgAnsi?.("toolPendingBg"), width));
		},

		renderResult(result: Result, _opt: unknown, theme: ThemeLike, ctx: RenderCtxLike) {
			resolveBaseBackground(theme);
			const r = result;
			const text = (ctx as RenderCtxLike).lastComponent ?? new TC("", 0, 0);
			if (ctx.isError) {
				const message = (getText(r) || "Error").split("\n").map((line) => theme.fg("error", line));
				return frameText(text, (width) => frameResult(theme, width, message, BG_ERROR));
			}
			const d = r.details as FindDetails | undefined;
			if (d?._type === "findResult") {
				if (!d.text.trim()) {
					return frameText(text, (width) => frameResult(theme, width, [theme.fg("dim", "0 files")]));
				}
				if (!areToolResultsExpanded()) {
					const duration = renderToolDuration(r);
					const body = `${theme.fg("success", "✓")} ${FG_DIM}${d.matchCount} files — ${RESULT_TOGGLE_HINT} to expand results${RST}${duration ? `${FG_DIM}· ${duration}${RST}` : ""}`;
					return frameText(text, (width) => [
						frameDivider(theme, undefined, width),
						frameRow(body, undefined, width),
						framePadding(undefined, width),
					].join("\n"));
				}
				const rendered = renderFindResults(d.text, theme)
					.split("\n")
					.map((l) => `${TOOL_RESULT_INDENT}${l}`)
					.join("\n");
				const duration = renderToolDuration(r);
				const summary = `${theme.fg("success", "✓")} ${theme.fg("dim", `${d.matchCount} files`)}${duration ? `${FG_DIM}· ${duration}${RST}` : ""}`;
				return frameText(text, (width) => [
					frameDivider(theme, undefined, width),
					frameRow(summary, undefined, width),
					...rendered.split("\n").map((line) => frameRow(line, undefined, width)),
					framePadding(undefined, width),
				].join("\n"));
			}
			const fc = r.content?.[0] as TextContent | undefined;
			return frameText(text, (width) => frameResult(theme, width, [theme.fg("dim", fc?.text?.slice(0, 120) ?? "0 files")]));
		},
	} as unknown as ToolDefinition);
}
