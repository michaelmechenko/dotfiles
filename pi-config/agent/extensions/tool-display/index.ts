import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { Key } from "@earendil-works/pi-tui";
import { installHostDecorator } from "./host-decorator.js";
import { resetToolDisplayState, toggleToolCallsExpanded, toggleToolOutputWrap } from "./state.js";

export default function (pi: ExtensionAPI): void {
	installHostDecorator();
	pi.on("session_start", () => {
		resetToolDisplayState();
	});

	pi.registerShortcut(Key.ctrlShift("o"), {
		description: "Toggle compact tool calls",
		handler: (ctx: ExtensionContext) => {
			const expanded = toggleToolCallsExpanded();
			ctx.ui.notify(`Tool calls: ${expanded ? "expanded" : "compact"}`, "info");
		},
	});

	const toggleWrap = (ctx: ExtensionContext) => {
		const wrapped = toggleToolOutputWrap();
		ctx.ui.notify(`Tool output wrapping: ${wrapped ? "on" : "off"}`, "info");
	};

	pi.registerShortcut(Key.ctrlShift("w"), {
		description: "Toggle tool-output word wrap",
		handler: toggleWrap,
	});
	pi.registerCommand("tool-wrap", {
		description: "Toggle tool-output word wrap for this session",
		handler: async (_args, ctx) => toggleWrap(ctx),
	});
}
