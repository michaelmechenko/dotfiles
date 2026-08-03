import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";

async function renameSession(pi: ExtensionAPI, ctx: ExtensionContext, supplied?: string): Promise<void> {
	const current = pi.getSessionName() ?? "";
	const value = supplied === undefined ? await ctx.ui.input("Rename session", current) : supplied;
	const name = value?.trim();
	if (!name) return;
	pi.setSessionName(name);
	ctx.ui.notify(`Session renamed: ${pi.getSessionName() ?? name}`, "info");
}

export default function (pi: ExtensionAPI): void {
	pi.registerShortcut("ctrl+r", {
		description: "Rename the current session",
		handler: (ctx) => renameSession(pi, ctx),
	});
	pi.registerCommand("rename", {
		description: "Rename the current live session",
		handler: (args, ctx) => renameSession(pi, ctx, args || undefined),
	});
}
