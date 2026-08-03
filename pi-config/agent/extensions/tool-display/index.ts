import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { Key } from "@earendil-works/pi-tui";
import { refreshToolRows, resetToolResultsExpanded, toggleToolResultsExpanded } from "./state.js";

export default function (pi: ExtensionAPI): void {
	pi.on("session_start", () => {
		resetToolResultsExpanded();
	});

	pi.registerShortcut(Key.ctrlShift("o"), {
		description: "Toggle compact tool results",
		handler: (ctx: ExtensionContext) => {
			const expanded = toggleToolResultsExpanded();
			refreshToolRows(ctx);
			ctx.ui.notify(`Tool results: ${expanded ? "expanded" : "compact"}`, "info");
		},
	});
}
