/**
 * Prompt Stash — Claude Code's Ctrl+S "stash or restore prompt" behavior for pi.
 *
 * From Claude Code's docs (code.claude.com/docs/en/interactive-mode):
 *   "With text in the input, stashes it and clears the prompt. Pressed again
 *   on an empty prompt, restores the stashed text, cursor position, and
 *   pasted content."
 *
 * pi's extension API exposes `ctx.ui.getEditorText()` / `setEditorText()` but
 * no cursor-position or pasted-attachment accessors, so this reimplements the
 * text half of that contract: Ctrl+S with a non-empty editor stashes the text
 * and clears the editor; Ctrl+S with an empty editor (and a live stash) pops
 * it back in. Cursor position and pasted-image content aren't restorable
 * through the current extension API.
 *
 * Stash is in-memory only (per pi process), matching Claude Code's stash
 * being cleared on restart. It intentionally is NOT session-persisted.
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

export default function (pi: ExtensionAPI) {
	let stashed: string | undefined;

	pi.registerShortcut("ctrl+s", {
		description: "Stash current prompt, or restore the last stashed prompt",
		handler: async (ctx) => {
			if (ctx.mode !== "tui") return;

			const current = ctx.ui.getEditorText();

			if (current && current.trim().length > 0) {
				stashed = current;
				ctx.ui.setEditorText("");
				ctx.ui.notify("Prompt stashed", "info");
				return;
			}

			if (stashed !== undefined) {
				ctx.ui.setEditorText(stashed);
				stashed = undefined;
				return;
			}

			ctx.ui.notify("Nothing stashed", "warning");
		},
	});

	// Stash is process-lifetime only; drop it on session teardown so a
	// resumed/forked/new session doesn't silently inherit another session's
	// stashed draft.
	pi.on("session_shutdown", async () => {
		stashed = undefined;
	});
}
