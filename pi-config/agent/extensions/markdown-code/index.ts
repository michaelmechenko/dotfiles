import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { transformFencedMarkdown } from "./fences.ts";
import { installCodeBackground, selectCodeBackground } from "./background.ts";

export default function markdownCodeExtension(pi: ExtensionAPI): void {
	pi.registerMarkdownTransformer((markdown, context) => {
		selectCodeBackground(context.messageType);
		return transformFencedMarkdown(markdown);
	});
	let dispose: (() => void) | undefined;
	pi.on("session_start", (_event, ctx) => {
		dispose?.();
		if (ctx.mode === "tui") {
			dispose = installCodeBackground((text) => ctx.ui.theme.bg("toolPendingBg", text));
		}
	});
	pi.on("session_shutdown", () => {
		dispose?.();
		dispose = undefined;
	});
}
