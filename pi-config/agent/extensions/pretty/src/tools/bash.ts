/* pi-pretty: bash tool -- command execution with styled output. */

import type { AgentToolResult, ExtensionAPI, ExtensionContext, ToolDefinition } from "@earendil-works/pi-coding-agent";
import { truncateToWidth } from "@earendil-works/pi-tui";
import { resolveBaseBackground, TOOL_RESULT_INDENT, termWidth } from "../config.js";
import { compactErrorLines, inferBashExitCode, stripBashExitStatusLine } from "../helpers.js";
import { fillToolBackground, renderFrameStatus, renderToolDuration, renderToolError } from "../render.js";
import { resolveTextCtor } from "../tui-text.js";
import type { BashDetails, ComponentLike, RenderCtxLike, SdkToolDef, TextContent, ThemeLike } from "../types.js";
import { wrapExecuteWithMetrics } from "./metrics.js";
import { areToolCallsExpanded, CALL_TOGGLE_HINT, previewResult } from "../../../tool-display/state.js";
import { cardEdgeColor, frameDivider, framePadding, frameResult, frameRow, frameRows, frameText } from "../../../tool-display/frame.js";

type Result = AgentToolResult<Record<string, unknown>>;

export function registerBashTool(
	pi: ExtensionAPI,
	_cwd: string,
	_fffService: unknown,
	sdkTool: SdkToolDef,
	TextComp?: new (t?: string, x?: number, y?: number) => { setText(v: string): void },
): void {
	const TC = resolveTextCtor(TextComp);

	pi.registerTool({
		name: "bash",
		label: "Bash",
		description: sdkTool.description
			? `${sdkTool.description} For text search: \`rg -n\`.`
			: "Execute shell commands. For text search: `rg -n`.",
		promptSnippet: "Execute commands via bash. For text search: `rg -n`.",
		promptGuidelines: [
			"For text search: `rg -n`. If no results, try `rg -u` (respects .gitignore by default).",
			"In rg: | means alternation, \\| means literal pipe. Opposite of GNU grep. Never use \\| for alternation.",
			"Prefer the dedicated `grep`/`find` tools, or `rg`/`fd` directly in bash, over the `grep`/`find` binaries.",
		],
		parameters: sdkTool.parameters,
		renderShell: "self",

		execute: wrapExecuteWithMetrics(async (tid, params, sig, _upd, ctx: ExtensionContext) => {
			try {
				return (await sdkTool.execute(tid, params, sig, undefined, ctx)) as Result;
			} catch (error: unknown) {
				const msg = error instanceof Error ? error.message : String(error);
				return {
					content: [{ type: "text" as const, text: msg }],
					details: {
						_type: "bashResult",
						text: msg,
						exitCode: 1,
						command: String((params as any).command ?? ""),
					} as BashDetails,
				};
			}
		}),

		renderCall(args: any, theme: ThemeLike, ctx: RenderCtxLike) {
			resolveBaseBackground(theme);
			const text = ctx.lastComponent ?? new TC("", 0, 0);
			const rawCmd = String(args.command ?? "");

			// Build the header string against a specific width. Called both for the
			// initial synchronous paint (guessed width, below) and reactively from
			// the `.render` override (real width, at every draw) so a terminal/pane
			// resize after the initial render can't leave a stale, too-wide string
			// baked into the component -- pi-tui's Text always word-wraps whatever
			// string it's given against the width it's actually drawn at, so a
			// stale wide string gets broken across lines (e.g. a lone "$" on its
			// own line) instead of re-truncated to one line. See renderResult below
			// for the same pattern.
			const buildHeader = (width: number): string => {
				const tw = width || 80;
				const t = typeof args.timeout === "number" ? ` ${theme.fg("muted", `(timeout ${args.timeout}s)`)}` : "";
				const status = ctx.isError ? "error" : "pending";
				const bg = theme.getBgAnsi?.("toolSuccessBg");
				const fit = (line: string, max: number): string => truncateToWidth(line, Math.max(1, max), "…");
				const cmdLines = rawCmd.length === 0 ? [theme.fg("toolOutput", "...")] : rawCmd.split("\n");
				const budget = Math.max(8, tw - 4);
				const line0Budget = t ? Math.max(8, tw - 22) : budget;
				const rows: string[] = [""];
				if (areToolCallsExpanded() || cmdLines.length <= 2) {
					rows.push(renderFrameStatus({ title: `$ ${fit(cmdLines[0], line0Budget)}${t}`, status, theme }));
					for (let i = 1; i < cmdLines.length; i++) {
						rows.push(`${TOOL_RESULT_INDENT}  ${fit(cmdLines[i], budget)}`);
					}
				} else {
					rows.push(renderFrameStatus({ title: `$ ${fit(cmdLines[0], line0Budget)}${t}`, status, theme }));
					rows.push(`${TOOL_RESULT_INDENT}  ${fit(cmdLines[1], budget)}`);
					rows.push(`${TOOL_RESULT_INDENT}${theme.fg("dim", `… ${cmdLines.length - 2} more lines (${CALL_TOGGLE_HINT})`)}`);
				}
				return frameRows(rows, bg, tw);
			};

			text.setText(buildHeader(termWidth()));

			const baseRender =
				typeof (text as ComponentLike).render === "function" ? (text as ComponentLike).render.bind(text) : null;
			if (baseRender) {
				let key: string | undefined;
				(text as unknown as Record<string, unknown>).render = (w: number) => {
					const width = Math.max(1, Math.floor(w || termWidth()));
					const k = `bashCall:${areToolCallsExpanded() ? "1" : "0"}:${width}:${ctx.isError ? "1" : "0"}:${rawCmd.length}`;
					if (key !== k) {
						text.setText(buildHeader(width));
						key = k;
					}
					return baseRender(width);
				};
			}
			return text;
		},

		renderResult(result: Result, _opt: unknown, theme: ThemeLike, ctx: RenderCtxLike) {
			resolveBaseBackground(theme);

			const text = ctx.lastComponent ?? new TC("", 0, 0);

			const details = result.details;
			const tc = getText(result);
			const d: BashDetails | undefined =
				(details as BashDetails)?._type === "bashResult"
					? (details as BashDetails)
					: tc || ctx.isError
						? {
								_type: "bashResult",
								text: tc || "Error",
								exitCode: inferBashExitCode(tc, ctx.isError ? 1 : 0),
								command: "",
							}
						: undefined;

			if (d?._type === "bashResult") {
				const isErr = ctx.isError || (d.exitCode !== null && d.exitCode !== 0);
				const cleaned = stripBashExitStatusLine(d.text);
				const output = isErr ? compactErrorLines(cleaned).join("\n") : cleaned;
				const lineCount = output.split("\n").length;
				const resultsExpanded = !!ctx.expanded;
				const info = [`${lineCount} lines`, renderToolDuration(result)]
					.filter(Boolean)
					.map((part) => theme.fg("dim", part))
					.join(theme.fg("dim", " · "));
				const resultIcon = theme.fg(isErr ? "error" : "success", isErr ? "✗" : "✓");
				const header = `${resultIcon} ${info}`;
				const rw = termWidth();

				const resultBg = isErr ? theme.getBgAnsi?.("toolErrorBg") : theme.getBgAnsi?.("toolSuccessBg");
				const edge = isErr ? cardEdgeColor("error", theme) : undefined;

				const renderFn = (w: number) => {
					if (!output.trim()) return frameResult(theme, w, [header], resultBg, edge);
					const preview = previewResult(output, 3, resultsExpanded);
					const out = [
						frameDivider(theme, resultBg, w, edge),
						frameRow(header, resultBg, w, edge),
						...preview.body.split("\n").map((line: string) => frameRow(line, resultBg, w, edge)),
					];
					if (preview.remaining) out.push(frameRow(theme.fg("dim", `… ${preview.remaining} more lines (ctrl+o)`), resultBg, w, edge));
					out.push(framePadding(resultBg, w, edge));
					return out.join("\n");
				};

				text.setText(renderFn(rw));
				const baseRender =
					typeof (text as ComponentLike).render === "function" ? (text as ComponentLike).render.bind(text) : null;
				if (baseRender) {
					let key: string | undefined;
					(text as unknown as Record<string, unknown>).render = (w: number) => {
						const width = Math.max(1, Math.floor(w || termWidth()));
						const k = `bash:${resultsExpanded ? "1" : "0"}:${width}:${d.exitCode ?? "killed"}:${output.length}:${renderToolDuration(result)}`;
						if (key !== k) {
							text.setText(renderFn(width));
							key = k;
						}
						return baseRender(width);
					};
				}
				return text;
			}

			if (ctx.isError) {
				const message = (tc || "Error").split("\n").map((line) => theme.fg("error", line));
				return frameText(text, (width) => frameResult(theme, width, message, theme.getBgAnsi?.("toolErrorBg"), cardEdgeColor("error", theme)));
			}
			const fc = result.content?.[0];
			return frameText(text, (width) => frameResult(theme, width, [theme.fg("dim", fc && "text" in fc ? String(fc.text).slice(0, 120) : "done")]));
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
