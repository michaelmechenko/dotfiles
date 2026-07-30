/**
 * whimsical — randomizes the TUI working-message text.
 *
 * Vendored from dmmulroy/.dotfiles (home/.pi/agent/extensions/whimsical.ts).
 * Message list trimmed to 3 entries per this repo's preference (upstream ships
 * a ~300-entry whimsical list).
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

const messages = ["hmm...", "erm...", "uhh..."];

function pickRandom(): string {
	return messages[Math.floor(Math.random() * messages.length)]!;
}

export default function (pi: ExtensionAPI) {
	pi.on("turn_start", async (_event, ctx) => {
		ctx.ui.setWorkingMessage(pickRandom());
	});

	pi.on("turn_end", async (_event, ctx) => {
		ctx.ui.setWorkingMessage(); // Reset for next time
	});
}
