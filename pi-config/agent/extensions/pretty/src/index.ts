/**
 * pi-pretty — Pretty terminal output for pi built-in tools.
 *
 * Enhances read, bash, ls, find, and grep with:
 *   • Syntax-highlighted file content (Shiki)
 *   • Colored bash exit status + output
 *   • Tree-view directory listings with file-type icons
 *   • fd/rg-backed find/grep (via Pi's built-in SDK tools)
 *   • Custom ANSI rendering for all tools
 */

import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import * as hostSdk from "@earendil-works/pi-coding-agent";
import { registerBashTool } from "./tools/bash.js";
import { registerFindTool } from "./tools/find.js";
import { registerGrepTool } from "./tools/grep.js";
import { registerLsTool } from "./tools/ls.js";
import { registerReadTool } from "./tools/read.js";
import type { PiPrettyDeps, SdkTools } from "./types.js";

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const DEFAULT_DISABLED_TOOLS = new Set(["ls"]);

function envTools(name: "PRETTY_DISABLE_TOOLS" | "PRETTY_ENABLE_TOOLS"): Set<string> {
	return new Set(
		(process.env[name] ?? "")
			.split(",")
			.map((tool) => tool.trim().toLowerCase())
			.filter(Boolean),
	);
}

// ---------------------------------------------------------------------------
// Entry
// ---------------------------------------------------------------------------

export type { PiPrettyDeps };

export default async function piPrettyExtension(pi: ExtensionAPI, deps?: PiPrettyDeps): Promise<void> {
	const disabledTools = envTools("PRETTY_DISABLE_TOOLS");
	const enabledTools = envTools("PRETTY_ENABLE_TOOLS");
	const isToolEnabled = (name: string) => {
		const normalizedName = name.toLowerCase();
		return (
			!disabledTools.has(normalizedName) &&
			(!DEFAULT_DISABLED_TOOLS.has(normalizedName) || enabledTools.has(normalizedName))
		);
	};
	const cwd = process.cwd();

	// Text component for custom rendering (DI-friendly)
	const TextComp = deps?.TextComponent;

	// ------------------------------------------------------------------
	// Session lifecycle
	// ------------------------------------------------------------------

	pi.on("session_start", async (_event: unknown, ctx: ExtensionContext) => {
		if (ctx.mode === "tui") ctx.ui.setToolsExpanded(false);
	});

	// ------------------------------------------------------------------
	// Resolve SDK tools
	// ------------------------------------------------------------------
	// Pi aliases static SDK imports to its host package for managed extensions.
	// Native dynamic imports bypass that alias because the managed npm root omits
	// Pi peer dependencies.

	const sdk: SdkTools = deps?.sdk ?? {
		createReadToolDefinition: hostSdk.createReadToolDefinition,
		createBashToolDefinition: hostSdk.createBashToolDefinition,
		createLsToolDefinition: hostSdk.createLsToolDefinition,
		createFindToolDefinition: hostSdk.createFindToolDefinition,
		createGrepToolDefinition: hostSdk.createGrepToolDefinition,
	};
	const createReadTool = sdk.createReadToolDefinition ?? sdk.createReadTool;
	const createBashTool = sdk.createBashToolDefinition ?? sdk.createBashTool;
	const createLsTool = sdk.createLsToolDefinition ?? sdk.createLsTool;
	const createFindTool = sdk.createFindToolDefinition ?? sdk.createFindTool;
	const createGrepTool = sdk.createGrepToolDefinition ?? sdk.createGrepTool;

	// ------------------------------------------------------------------
	// Tool registration
	// ------------------------------------------------------------------

	if (isToolEnabled("read") && createReadTool) {
		registerReadTool(pi, cwd, null, createReadTool(cwd), TextComp);
	}
	if (isToolEnabled("bash") && createBashTool) {
		registerBashTool(pi, cwd, null, createBashTool(cwd), TextComp);
	}
	if (isToolEnabled("ls") && createLsTool) {
		registerLsTool(pi, cwd, null, createLsTool(cwd), TextComp);
	}
	if (isToolEnabled("find") && createFindTool) {
		registerFindTool(pi, cwd, null, createFindTool(cwd), TextComp);
	}
	if (isToolEnabled("grep") && createGrepTool) {
		registerGrepTool(pi, cwd, null, createGrepTool(cwd), TextComp);
	}

}
