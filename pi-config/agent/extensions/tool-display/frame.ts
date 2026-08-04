import { truncateToWidth } from "@earendil-works/pi-tui";
import type { Component } from "@earendil-works/pi-tui";

export type ToolFrameTheme = {
	fg(name: string, value: string): string;
	getBgAnsi?: (name: string) => string;
};

export const FRAME_OUTER_INDENT = " ";
const PAD = FRAME_OUTER_INDENT;

type WidthAwareText = {
	setText(value: string): void;
	render(width: number): string[];
	__toolFrame?: { build: (width: number) => string; width: number };
};

/**
 * Component wrapper for rich tool results. Child components render against the
 * interior width; every emitted line is then fitted and given the same outer
 * frame as text renderers.
 */
class FramedComponent implements Component {
	constructor(
		private readonly theme: ToolFrameTheme,
		private readonly children: Component[],
		private readonly background: string | undefined,
		private readonly includeDivider: boolean,
	) {}

	render(width: number): string[] {
		const actual = Math.max(2, Math.floor(width || process.stdout.columns || 80));
		const rows: string[] = [];
		if (this.includeDivider) rows.push(frameDivider(this.theme, this.background, actual));
		for (const child of this.children) {
			for (const line of child.render(Math.max(1, actual - 2))) {
				rows.push(frameRow(line, this.background, actual));
			}
		}
		rows.push(framePadding(this.background, actual));
		return rows;
	}

	invalidate(): void {
		for (const child of this.children) child.invalidate();
	}
}

export function frameComponentResult(
	theme: ToolFrameTheme,
	children: Component[],
	options: { background?: string } = {},
): Component {
	return new FramedComponent(theme, children, options.background ?? theme.getBgAnsi?.("toolSuccessBg"), true);
}

export function frameText<T extends WidthAwareText>(text: T, build: (width: number) => string): T {
	if (!text.__toolFrame) {
		const baseRender = text.render.bind(text);
		text.__toolFrame = { build, width: 0 };
		text.render = (width: number) => {
			const state = text.__toolFrame!;
			const actual = Math.max(2, Math.floor(width || process.stdout.columns || 80));
			if (state.width !== actual) {
				state.width = actual;
				text.setText(state.build(actual));
			}
			return baseRender(width);
		};
	}
	text.__toolFrame.build = build;
	text.__toolFrame.width = 0;
	return text;
}

export function frameRow(content: string, background: string | undefined, width: number): string {
	const actual = Math.max(2, width);
	const interior = truncateToWidth(content, actual - 2, "", true);
	const padded = `${PAD}${interior}${PAD}`;
	if (!background) return padded;

	// Embedded syntax/Markdown/diff styles commonly emit a full SGR reset.
	// Reapply the row background after those resets so every cell in the outer
	// frame stays on the same semantic surface, then terminate it at the row end.
	const withBackground = padded.replace(/\x1b\[0m/g, `\x1b[0m${background}`);
	return `${background}${withBackground}\x1b[0m`;
}

export function framePadding(background: string | undefined, width: number): string {
	return frameRow("", background, width);
}

export function frameDivider(theme: ToolFrameTheme, background: string | undefined, width: number): string {
	return frameRow(theme.fg("dim", "─".repeat(Math.max(1, width - 2))), background, width);
}

export function frameRows(lines: string[], background: string | undefined, width: number): string {
	return lines
		.flatMap((line) => line.split("\n"))
		.map((line) => frameRow(line, background, width))
		.join("\n");
}

export function frameCall(
	theme: ToolFrameTheme,
	width: number,
	call: string,
	options: { error?: boolean; pending?: boolean } = {},
): string {
	const background = theme.getBgAnsi?.(options.error ? "toolErrorBg" : options.pending ? "toolPendingBg" : "toolSuccessBg");
	return frameRows(["", call], background, width);
}

export function frameResult(
	themeOrOptions: ToolFrameTheme | { theme: ToolFrameTheme; width: number; lines: string[]; background?: string },

	widthArg?: number,
	linesArg?: string[],
	backgroundArg?: string,
): string {
	const options = typeof themeOrOptions === "object" && "theme" in themeOrOptions
		? themeOrOptions
		: { theme: themeOrOptions, width: widthArg ?? 80, lines: linesArg ?? [], background: backgroundArg };
	const background = options.background ?? options.theme.getBgAnsi?.("toolSuccessBg");
	return [
		frameDivider(options.theme, background, options.width),
		frameRows(options.lines, background, options.width),
		framePadding(background, options.width),
	].join("\n");
}

export const toolCallFrame = frameCall;

export function toolErrorFrame(theme: ToolFrameTheme, width: number, call: string, message: string): string {
	return toolFrame(theme, width, call, [theme.fg("error", message)], { error: true });
}

export function toolEmptyFrame(theme: ToolFrameTheme, width: number, call: string, message = "(no output)"): string {
	return toolResultFrame(theme, width, [theme.fg("dim", message)]);
}

export function toolResultFrame(
	theme: ToolFrameTheme,
	width: number,
	result: string[],
	options: { error?: boolean; pending?: boolean } = {},
): string {
	const background = theme.getBgAnsi?.(options.error ? "toolErrorBg" : options.pending ? "toolPendingBg" : "toolSuccessBg");
	return frameResult(theme, width, result, background);
}

export function toolFrame(
	theme: ToolFrameTheme,
	width: number,
	call: string,
	result?: string[],
	options: { error?: boolean; pending?: boolean } = {},
): string {
	const callBg = theme.getBgAnsi?.(options.error ? "toolErrorBg" : options.pending ? "toolPendingBg" : "toolSuccessBg");
	const resultBg = theme.getBgAnsi?.(options.error ? "toolErrorBg" : options.pending ? "toolPendingBg" : "toolSuccessBg");
	const rows = [frameRows(["", call], callBg, width)];
	if (result) {
		rows.push(frameDivider(theme, resultBg, width));
		rows.push(frameRows(result, resultBg, width));
	}
	rows.push(framePadding(result ? resultBg : callBg, width));
	return rows.join("\n");
}
