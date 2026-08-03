import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

const LEVELS = ["off", "minimal", "low", "medium", "high", "xhigh", "max"] as const;

export default function (pi: ExtensionAPI): void {
	pi.registerShortcut("f13", {
		description: "Cycle thinking level backward",
		handler: (ctx) => {
			const current = pi.getThinkingLevel();
			const index = LEVELS.indexOf(current);
			const previous = LEVELS[(index <= 0 ? LEVELS.length : index) - 1];
			pi.setThinkingLevel(previous);
			ctx.ui.notify(`Thinking: ${pi.getThinkingLevel()}`, "info");
		},
	});
}
