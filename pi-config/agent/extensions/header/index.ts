/**
 * Custom Header Extension
 *
 * Duplicated from the dashboard header in davis7dotsh/my-pi-setup
 * (extensions/ui-customization/index.ts), simplified to a plain "pi"
 * wordmark (not upstream's block-drawing "PI" art, and no companion
 * git-info/model-info dashboard), a directory subtitle, and an
 * enabled/disabled extension-count summary line. Colors come from the
 * active theme's `accent`/`muted`/`dim` roles (no hardcoded hex),
 * consistent with this repo's palette discipline.
 */

import { homedir } from "node:os";
import path, { relative } from "node:path";
import {
	DefaultPackageManager,
	getAgentDir,
	SettingsManager,
	type ExtensionAPI,
	type ResolvedResource,
} from "@earendil-works/pi-coding-agent";
import { truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";

const WORDMARK = "pi";

function formatDirectory(cwd: string): string {
	const home = homedir();
	if (cwd === home) return "~";
	if (cwd.startsWith(`${home}/`)) return `~/${relative(home, cwd)}`;
	return cwd;
}

function center(text: string, width: number): string {
	const padding = Math.max(0, Math.floor((width - visibleWidth(text)) / 2));
	return truncateToWidth(`${" ".repeat(padding)}${text}`, width);
}

interface ExtensionSummary {
	enabledCount: number;
	totalCount: number;
	disabledNames: string[];
}

/**
 * Human-readable name for a resolved extension resource. Top-level (bare,
 * auto-discovered) extensions always live at `<...>/extensions/<name>/...`,
 * so the segment right after "extensions" is the extension's own directory
 * name -- this works even when the entry point is nested (e.g.
 * `skill-toggle/src/index.ts`), where naively taking the immediate parent
 * directory would wrongly report "src".
 */
function extensionDisplayName(resource: ResolvedResource): string {
	if (resource.metadata.origin === "package") return resource.metadata.source;
	const segments = resource.path.split(path.sep);
	const extensionsIndex = segments.lastIndexOf("extensions");
	if (extensionsIndex !== -1 && extensionsIndex + 1 < segments.length) {
		return segments[extensionsIndex + 1] as string;
	}
	const base = path.basename(resource.path, path.extname(resource.path));
	return base === "index" ? path.basename(path.dirname(resource.path)) : base;
}

/** Resolve enabled/disabled extension counts the same way the extension-toggle extension does. */
async function summarizeExtensions(cwd: string): Promise<ExtensionSummary | undefined> {
	try {
		const agentDir = getAgentDir();
		const settingsManager = SettingsManager.create(cwd, agentDir);
		const packageManager = new DefaultPackageManager({ cwd, agentDir, settingsManager });
		const resolved = await packageManager.resolve();

		const totalCount = resolved.extensions.length;
		const enabledCount = resolved.extensions.filter((r) => r.enabled).length;
		const disabledNames = resolved.extensions
			.filter((r) => !r.enabled)
			.map(extensionDisplayName)
			.sort((a, b) => a.localeCompare(b));

		return { enabledCount, totalCount, disabledNames };
	} catch {
		return undefined;
	}
}

function formatExtensionSummaryLine(summary: ExtensionSummary): string {
	if (summary.disabledNames.length === 0) {
		return `${summary.totalCount} extensions enabled`;
	}
	return `${summary.enabledCount}/${summary.totalCount} extensions enabled \u00b7 disabled: ${summary.disabledNames.join(", ")}`;
}

export default function header(pi: ExtensionAPI) {
	pi.on("session_start", async (_event, ctx) => {
		if (ctx.mode !== "tui") return;

		const subtitle = formatDirectory(ctx.cwd);
		const summary = await summarizeExtensions(ctx.cwd);

		ctx.ui.setHeader((_tui, theme) => {
			return {
				render(width: number): string[] {
					const lines = [
						"",
						center(theme.bold(theme.fg("accent", WORDMARK)), width),
						center(theme.fg("muted", subtitle), width),
					];
					if (summary) {
						lines.push(center(theme.fg("dim", formatExtensionSummaryLine(summary)), width));
					}
					lines.push("");
					return lines;
				},
				invalidate() {},
			};
		});
	});

	pi.on("session_shutdown", (_event, ctx) => {
		if (ctx.mode === "tui") ctx.ui.setHeader(undefined);
	});

	pi.registerCommand("builtin-header", {
		description: "Restore built-in header with keybinding hints",
		handler: async (_args, ctx) => {
			ctx.ui.setHeader(undefined);
			ctx.ui.notify("Built-in header restored", "info");
		},
	});
}
