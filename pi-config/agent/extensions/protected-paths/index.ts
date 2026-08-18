/** Blocks mutations to credentials, VCS metadata, and dependency directories. */
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { isProtectedPath, mutationPaths } from "./path-policy.ts";

export default function (pi: ExtensionAPI) {
	pi.on("tool_call", async (event, ctx) => {
		const paths = mutationPaths(event.toolName, event.input);
		const protectedPath = paths.find((path) => isProtectedPath(path, ctx.cwd));
		if (protectedPath === undefined) return undefined;
		const display = String(protectedPath);
		if (ctx.hasUI) ctx.ui.notify(`Blocked mutation to protected path: ${display}`, "warning");
		return { block: true, reason: `Path "${display}" is protected` };
	});
}
