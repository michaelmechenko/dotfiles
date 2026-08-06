/**
 * Host-level default-shell decorator for ToolExecutionComponent.
 *
 * Pi's built-in tool rows that use the default `Box` shell (i.e. tools that do
 * NOT set `renderShell: "self"`) get two extra visual elements, matching the
 * `pretty` read/bash renderers:
 *   1. a status marker (`○` pending / `✓` success / `✗` error) prefixed to the
 *      first call line;
 *   2. a dim divider row placed between the call content and the result
 *      content (only when a result is present).
 *
 * The decorator never touches `renderShell: "self"` tools (read, bash, and the
 * diff tools own their own framing) and never re-implements any tool's
 * renderer — it only reuses each instance's existing `contentBox` children and
 * `bgFn`, so semantic pending/success/error backgrounds, rich components,
 * `ctrl+o` expansion, and image handling all remain Pi's.
 *
 * Compatibility: the prototype patch is gated on the expected shape of
 * `ToolExecutionComponent`. If a future Pi build changes the private fields
 * (`contentBox`, `toolName`, `isPartial`, `result`, `getRenderShell`,
 * `hideComponent`) or the `Box` contract, every decorated render falls back to
 * Pi's unmodified output via the original `render` (caught per-call) and the
 * whole patch is skipped on install with a one-line warning.
 */

import { ToolExecutionComponent } from "@earendil-works/pi-coding-agent";
import { visibleWidth } from "@earendil-works/pi-tui";

const THEME_KEY = Symbol.for("@earendil-works/pi-coding-agent:theme");
const PATCH_FLAG = Symbol.for("pi.tool-display.hostDecorator.v1");
const WARNED_FLAG = Symbol.for("pi.tool-display.hostDecorator.warned");

type BgFn = ((text: string) => string) | undefined;

function getTheme(): any {
	return (globalThis as { [k: symbol]: any })[THEME_KEY];
}

function statusIcon(instance: any, theme: any): string {
	if (instance.result?.isError) return theme.fg("error", "✗");
	if (instance.isPartial) return theme.fg("warning", "○");
	return theme.fg("success", "✓");
}

/** Pad a line to the full row width and apply the Box background, matching Box.applyBg. */
function applyBg(line: string, width: number, bgFn: BgFn): string {
	const vis = visibleWidth(line);
	const pad = Math.max(0, width - vis);
	const padded = line + " ".repeat(pad);
	return bgFn ? bgFn(padded) : padded;
}

/** Rebuild a default-shell contentBox's output with the status icon prefixed onto the
 * first call line and a divider inserted before the result. */
function decoratedBox(box: any, instance: any, width: number, theme: any): string[] {
	const contentWidth = Math.max(1, width - 2);
	const callWidth = Math.max(1, contentWidth - 2);
	const bgFn: BgFn = box.bgFn;
	const children: any[] = box.children ?? [];
	if (children.length === 0) return box.render?.call?.(box, width) ?? [];

	const callChild = children[0];
	const resultChild = children[1];

	const out: string[] = [];
	// Top padding (Box paddingY = 1).
	out.push(applyBg("", width, bgFn));

	if (callChild) {
		// Render the call content at contentWidth - 2 so the two-cell status-icon
		// prefix (icon + space) fits without truncation or an ellipsis, and so
		// wrapped continuation lines align under the content (column 3).
		const callLines = callChild.render(callWidth) as string[];
		const icon = statusIcon(instance, theme);
		if (callLines.length > 0) {
			out.push(applyBg(` ${icon} ${callLines[0]}`, width, bgFn));
			for (let i = 1; i < callLines.length; i++) out.push(applyBg(`   ${callLines[i]}`, width, bgFn));
		} else {
			out.push(applyBg(` ${icon}`, width, bgFn));
		}
	}

	// Divider + result content (only when a result row exists).
	if (resultChild) {
		out.push(applyBg(` ${theme.fg("dim", "─".repeat(contentWidth))}`, width, bgFn));
		for (const line of resultChild.render(contentWidth)) out.push(applyBg(` ${line}`, width, bgFn));
	}

	// Bottom padding.
	out.push(applyBg("", width, bgFn));
	return out;
}

function reconstructDefault(instance: any, width: number, origRender: (w: number) => string[]): string[] {
	const box = instance.contentBox;
	const lines: string[] = [];
	for (const child of instance.children ?? []) {
		if (child === box) {
			lines.push(...decoratedBox(box, instance, width, getTheme()));
		} else {
			lines.push(...child.render(width));
		}
	}
	return lines;
}

export function installHostDecorator(): void {
	const proto: any = ToolExecutionComponent?.prototype;
	if (!proto || typeof proto.render !== "function" || typeof proto.getRenderShell !== "function") {
		if (!(globalThis as any)[WARNED_FLAG]) {
			(globalThis as any)[WARNED_FLAG] = true;
			console.warn("[tool-display] ToolExecutionComponent shape unrecognized; default-shell decorator skipped.");
		}
		return;
	}
	if (proto[PATCH_FLAG]) return; // idempotent across /reload
	proto[PATCH_FLAG] = true;

	const origRender = proto.render;
	proto.render = function (width: number): string[] {
		try {
			if (this.hideComponent) return [];
			if (this.getRenderShell?.() === "self") return origRender.call(this, width);
			if (!this.contentBox || typeof this.contentBox !== "object") return origRender.call(this, width);
			return reconstructDefault(this, width, (w: number) => origRender.call(this, w));
		} catch {
			// Per-call fallback: never let a decoration bug blank a tool row.
			return origRender.call(this, width);
		}
	};
}
