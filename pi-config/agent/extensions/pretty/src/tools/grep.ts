/* pi-pretty: grep tool -- rg-backed text search via Pi's built-in SDK grep tool. */

import type { AgentToolResult, ExtensionAPI, ExtensionContext, ToolDefinition } from "@earendil-works/pi-coding-agent";
import { BG_ERROR, FG_DIM, RST, resolveBaseBackground, TOOL_RESULT_INDENT } from "../config.js";
import { normalizeLineEndings, shortPath } from "../helpers.js";
import { fillToolBackground, fillToolCallBackground, renderCardHeader, renderToolError, renderToolResultDivider } from "../render.js";
import { resolveTextCtor } from "../tui-text.js";
import type { GrepDetails, RenderCtxLike, SdkToolDef, TextContent, ThemeLike } from "../types.js";
import { wrapExecuteWithMetrics } from "./metrics.js";
import { areToolResultsExpanded, RESULT_TOGGLE_HINT } from "../../../tool-display/state.js";

const invalidArg = "<missing>";

type Result = AgentToolResult<Record<string, unknown>>;

export function registerGrepTool(
	pi: ExtensionAPI,
	cwd: string,
	_fffService: unknown,
	sdkTool: SdkToolDef,
	TextComp?: new (t?: string, x?: number, y?: number) => { setText(v: string): void },
): void {
	const T = resolveTextCtor(TextComp);
	const home = process.env.HOME ?? "";

	pi.registerTool({
		name: "grep",
		label: "Grep",
		description: sdkTool.description ?? "Search file contents by pattern",
		parameters: sdkTool.parameters,

		execute: wrapExecuteWithMetrics(async (tid, params, sig, _upd, ctx: ExtensionContext) => {
			const p = params as any;
			const pattern = String(p.pattern ?? "");

			const result = (await sdkTool.execute(tid, p, sig, undefined, ctx)) as Result;
			for (const c of (result.content ?? []) as any[]) {
				if (c.type === "text") c.text = normalizeLineEndings(c.text);
			}
			const tc =
				((result.content ?? []) as TextContent[])
					.filter((c) => c.type === "text")
					.map((c) => c.text)
					.join("\n") ?? "";
			result.details = {
				_type: "grepResult",
				text: tc,
				pattern,
				matchCount: tc ? tc.trim().split("\n").filter(Boolean).length : 0,
			} as GrepDetails;
			return result;
		}),

		renderCall(args: any, theme: ThemeLike, ctx: RenderCtxLike) {
			resolveBaseBackground(theme);
			const text = ctx.lastComponent ?? new T("", 0, 0);
			const pattern = args.pattern === null || args.pattern === undefined ? invalidArg : String(args.pattern);
			const path = args.path === null || args.path === undefined ? invalidArg : shortPath(cwd, home, String(args.path));
			const glob = args.glob;
			const limit = args.limit;
			const literal = args.literal === true;
			const caseInsensitive = args.caseInsensitive === true || args.ignoreCase === true;
			let title = `${theme.fg("toolTitle", theme.bold("grep"))} ${theme.fg("toolTitle", `/${pattern || ""}/`)}${theme.fg("toolOutput", ` in ${path}`)}`;
			if (glob) title += theme.fg("dim", ` (${String(glob)})`);
			if (limit !== undefined && limit !== null) title += theme.fg("dim", ` limit ${limit}`);
			if (literal) title += theme.fg("dim", ` (literal)`);
			if (caseInsensitive) title += theme.fg("dim", ` (case-insensitive)`);
			const headerLine = renderCardHeader({ title, status: ctx.isError ? "error" : "pending", theme });
			text.setText(fillToolCallBackground(`\n${headerLine}`, theme));
			return text;
		},

		renderResult(result: Result, _opt: unknown, theme: ThemeLike, ctx: RenderCtxLike) {
			resolveBaseBackground(theme);
			const text = ctx.lastComponent ?? new T("", 0, 0);
			if (ctx.isError) {
				text.setText(
					renderToolError(
						((result.content ?? []) as TextContent[])
							.filter((c) => c.type === "text")
							.map((c) => c.text)
							.join("\n") || "Error",
						theme,
					),
				);
				return text;
			}
			const d = result.details as GrepDetails | undefined;
			if (d?._type === "grepResult" && d.text) {
				const lines = d.text.split("\n");
				if (!areToolResultsExpanded()) {
					text.setText(
						fillToolBackground(
							`${renderToolResultDivider(theme, process.stdout.columns ?? 80)}\n${TOOL_RESULT_INDENT}${theme.fg("success", "✓")} ${FG_DIM}${lines.length} lines — ${RESULT_TOGGLE_HINT} to expand results${RST}\n`,
							ctx.isError ? BG_ERROR : undefined,
						),
					);
					return text;
				}
				const maxShow = lines.length;
				const show = lines.slice(0, maxShow);
				const remaining = lines.length - maxShow;
				const out: string[] = [];
				for (const line of show) {
					if (!line) continue;
					out.push(theme.fg("toolOutput", line));
				}
				if (remaining > 0) {
					out.push(theme.fg("muted", `… (${remaining} more ${remaining === 1 ? "line" : "lines"}, to expand)`));
				}
				const body = `${renderToolResultDivider(theme, process.stdout.columns ?? 80)}\n${TOOL_RESULT_INDENT}${theme.fg("success", "✓")} ${theme.fg("dim", `${lines.length} lines`)}\n${out.map((l) => `${TOOL_RESULT_INDENT}${l}`).join("\n")}\n`;
				text.setText(fillToolBackground(body, ctx.isError ? BG_ERROR : undefined));
				return text;
			}
			const fc = result.content?.[0];
			const fallback = fc && "text" in fc ? String(fc.text).slice(0, 120) : "no matches";
			text.setText(
				fillToolBackground(`${TOOL_RESULT_INDENT}${theme.fg("dim", fallback)}`, ctx.isError ? BG_ERROR : undefined),
			);
			return text;
		},
	} as unknown as ToolDefinition<any, any, any>);
}
