import { Container, Text, truncateToWidth } from "@earendil-works/pi-tui";

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
	return background ? `${background}${padded}` : padded;
}

export function framePadding(background: string | undefined, width: number): string {
	return frameRow("", background, width);
}

export function frameDivider(theme: ToolFrameTheme, background: string | undefined, width: number): string {
	return frameRow(theme.fg("dim", "─".repeat(Math.max(1, width - 2))), background, width);
}

export function frameRows(lines: string[], background: string | undefined, width: number): string {
	return lines.map((line) => frameRow(line, background, width)).join("\n");
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
	return [
		frameDivider(options.theme, options.background, options.width),
		...options.lines.map((line) => frameRow(line, options.background, options.width)),
		framePadding(options.background, options.width),
	].join("\n");
}

export function toolFrameContainer(
	theme: ToolFrameTheme,
	width: number,
	call: string,
	result: unknown[],
	options: { error?: boolean; pending?: boolean } = {},
): Container {
	const frame = new Container();
	const callBg = theme.getBgAnsi?.(options.error ? "toolErrorBg" : options.pending ? "toolPendingBg" : "toolSuccessBg");
	frame.addChild(new Text(framePadding(callBg, width), 0, 0));
	frame.addChild(new Text(frameRow(call, callBg, width), 0, 0));
	if (result.length > 0) {
		frame.addChild(new Text(frameDivider(theme, callBg, width), 0, 0));
		for (const child of result) frame.addChild(child as any);
	}
	frame.addChild(new Text(framePadding(callBg, width), 0, 0));
	return frame;
}

export function toolCallFrame(
	theme: ToolFrameTheme,
	width: number,
	call: string,
	options: { error?: boolean; pending?: boolean } = {},
): string {
	const background = theme.getBgAnsi?.(options.error ? "toolErrorBg" : options.pending ? "toolPendingBg" : "toolSuccessBg");
	return [framePadding(background, width), frameRow(call, background, width)].join("\n");
}

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
	const rows = [framePadding(callBg, width), frameRow(call, callBg, width)];
	if (result) {
		rows.push(frameDivider(theme, resultBg, width));
		rows.push(...result.map((line) => frameRow(line, resultBg, width)));
	}
	rows.push(framePadding(result ? resultBg : callBg, width));
	return rows.join("\n");
}
