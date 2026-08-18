/**
 * Tools Extension
 *
 * Provides a /tool-toggle command to enable/disable tools interactively.
 * Tool selection persists across session reloads and respects branch navigation.
 *
 * Usage:
 * 1. Copy this file to ~/.pi/agent/extensions/ or your project's .pi/extensions/
 * 2. Use /tool-toggle to open the tool selector
 */

import type { ExtensionAPI, ExtensionContext, ToolInfo } from "@earendil-works/pi-coding-agent";
import { getSettingsListTheme } from "@earendil-works/pi-coding-agent";
import { Container, type SettingItem, SettingsList } from "@earendil-works/pi-tui";
import { resolveToolSelection } from "./tool-policy.ts";

// State persisted to session
interface ToolsState {
	/** Only user-disabled tools are persisted so newly installed tools stay visible. */
	disabledTools: string[];
}

export default function toolsExtension(pi: ExtensionAPI) {
	// Persist a disabled delta rather than a stale enabled-tool snapshot.
	let disabledTools: Set<string> = new Set();
	let allTools: ToolInfo[] = [];

	// Persist current state
	function persistState() {
		pi.appendEntry<ToolsState>("tools-config", { disabledTools: Array.from(disabledTools).sort() });
	}

	// Never expand a plan/read-only positive allowlist. At normal startup every
	// tool is active, so this removes the persisted delta without hiding new tools.
	function applyTools(planOwnsTools = false) {
		pi.setActiveTools(resolveToolSelection(allTools.map((tool) => tool.name), pi.getActiveTools(), disabledTools, planOwnsTools));
	}
	function planOwnsToolsInBranch(ctx: ExtensionContext): boolean {
		let owned = false;
		for (const entry of ctx.sessionManager.getBranch()) {
			if (entry.type !== "custom" || entry.customType !== "plan-mode") continue;
			const plan = entry.data as { accessMode?: unknown; phase?: unknown } | undefined;
			owned = plan?.accessMode === "plan" || plan?.accessMode === "read-only" || plan?.phase === "executing";
		}
		return owned;
	}

	// Find the last tools-config entry in the current branch
	function restoreFromBranch(ctx: ExtensionContext) {
		allTools = pi.getAllTools();

		// Get entries in current branch only
		const branchEntries = ctx.sessionManager.getBranch();
		let savedDisabled: string[] | undefined;
		for (const entry of branchEntries) {
			if (entry.type !== "custom" || entry.customType !== "tools-config") continue;
			const data = entry.data as (ToolsState & { enabledTools?: string[] }) | undefined;
			if (data?.disabledTools) savedDisabled = data.disabledTools;
			// Migrate old full snapshots to a delta against the current catalog.
			else if (data?.enabledTools) savedDisabled = allTools.map((tool) => tool.name).filter((name) => !data.enabledTools!.includes(name));
		}
		const allToolNames = new Set(allTools.map((tool) => tool.name));
		disabledTools = new Set((savedDisabled ?? []).filter((name) => allToolNames.has(name)));
		applyTools(planOwnsToolsInBranch(ctx));
	}

	// Register /tool-toggle command
	pi.registerCommand("tool-toggle", {
		description: "Enable/disable tools",
		handler: async (_args, ctx) => {
			if (ctx.mode !== "tui") {
				ctx.ui.notify("/tool-toggle requires TUI mode", "error");
				return;
			}

			// Refresh tool list
			allTools = pi.getAllTools();

			await ctx.ui.custom((tui, theme, _kb, done) => {
				// Build settings items for each tool
				const items: SettingItem[] = allTools.map((tool) => ({
					id: tool.name,
					label: tool.name,
					currentValue: disabledTools.has(tool.name) ? "disabled" : "enabled",
					values: ["enabled", "disabled"],
				}));

				const container = new Container();
				container.addChild(
					new (class {
						render(_width: number) {
							return [theme.fg("accent", theme.bold("Tool Configuration")), ""];
						}
						invalidate() {}
					})(),
				);

				const settingsList = new SettingsList(
					items,
					Math.min(items.length + 2, 15),
					getSettingsListTheme(),
					(id, newValue) => {
						// Update enabled state and apply immediately
						if (newValue === "enabled") {
							disabledTools.delete(id);
						} else {
							disabledTools.add(id);
						}
						applyTools(planOwnsToolsInBranch(ctx));
						persistState();
					},
					() => {
						// Close dialog
						done(undefined);
					},
				);

				container.addChild(settingsList);

				const component = {
					render(width: number) {
						return container.render(width);
					},
					invalidate() {
						container.invalidate();
					},
					handleInput(data: string) {
						settingsList.handleInput?.(data);
						tui.requestRender();
					},
				};

				return component;
			});
		},
	});

	// Restore state on session start
	pi.on("session_start", async (_event, ctx) => {
		restoreFromBranch(ctx);
	});

	// Restore state when navigating the session tree
	pi.on("session_tree", async (_event, ctx) => {
		restoreFromBranch(ctx);
	});
}
