import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { Key } from "@earendil-works/pi-tui";
import { installHostDecorator } from "./host-decorator.js";
import { resetToolCallsExpanded, toggleToolCallsExpanded } from "./state.js";

export default function (pi: ExtensionAPI): void {
	installHostDecorator();
	pi.on("session_start", () => {
		resetToolCallsExpanded();
	});

	pi.registerShortcut(Key.ctrlShift("o"), {
		description: "Toggle compact tool calls",
		handler: (ctx: ExtensionContext) => {
			const expanded = toggleToolCallsExpanded();
			ctx.ui.notify(`Tool calls: ${expanded ? "expanded" : "compact"}`, "info");
		},
	});
}
