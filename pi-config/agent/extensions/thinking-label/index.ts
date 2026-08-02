/**
 * Thinking Label Extension
 *
 * Lowercases the "Thinking..." placeholder pi shows in place of a hidden
 * thinking block (`hideThinkingBlock: true` in settings.json) via
 * `ctx.ui.setHiddenThinkingLabel()`, to match the lowercase/no-shouting style
 * used elsewhere in this repo's TUI surfaces.
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

export default function (pi: ExtensionAPI): void {
	pi.on("session_start", async (_event, ctx) => {
		ctx.ui.setHiddenThinkingLabel("thinking...");
	});
}
