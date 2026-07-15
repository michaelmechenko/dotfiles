/**
 * Permission Gate Extension
 *
 * Prompts for confirmation before running potentially dangerous bash commands.
 * Patterns checked: rm -rf, sudo, chmod/chown 777
 *
 * Destructive/constructive commands (rm/chmod/chown) are auto-allowed without a
 * prompt when every path-like argument resolves inside /tmp, /private/tmp, or the
 * OS temp dir ($TMPDIR) -- i.e. scratch/test directories, not the real filesystem.
 * `sudo` is never auto-allowed regardless of path, since it's a privilege
 * escalation, not a path-scoped action.
 */

import { tmpdir } from "node:os";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

const dangerousPatterns = [/\brm\s+(-rf?|--recursive)/i, /\bsudo\b/i, /\b(chmod|chown)\b.*777/i];

function tmpPrefixes(): string[] {
	const prefixes = ["/tmp/", "/private/tmp/"];
	const osTmp = tmpdir();
	if (osTmp) prefixes.push(osTmp.endsWith("/") ? osTmp : `${osTmp}/`);
	return prefixes;
}

function hasPathTraversal(token: string): boolean {
	return token.split("/").some((segment) => segment === "..");
}

function isTmpPath(token: string): boolean {
	if (hasPathTraversal(token)) return false;
	if (token === "/tmp" || token === "/private/tmp") return true;
	if (/^\$\{?TMPDIR\}?/.test(token)) return true;
	return tmpPrefixes().some((prefix) => token.startsWith(prefix));
}

/** Extract path-like tokens (contains "/" or references $TMPDIR) from a bash command, ignoring flags. */
function extractPathArgs(command: string): string[] {
	return command
		.split(/\s+/)
		.map((token) => token.replace(/^['"]|['"]$/g, ""))
		.filter((token) => token.length > 0 && !token.startsWith("-") && (token.includes("/") || /^\$\{?TMPDIR\}?/.test(token)));
}

/** Whether every path-like argument in a dangerous rm/chmod/chown command is confined to a temp directory. */
function isConfinedToTmp(command: string): boolean {
	if (/\bsudo\b/i.test(command)) return false;
	const pathArgs = extractPathArgs(command);
	return pathArgs.length > 0 && pathArgs.every(isTmpPath);
}

export default function (pi: ExtensionAPI) {
	pi.on("tool_call", async (event, ctx) => {
		if (event.toolName !== "bash") return undefined;

		const command = event.input.command as string;
		const isDangerous = dangerousPatterns.some((p) => p.test(command));
		if (!isDangerous) return undefined;

		if (isConfinedToTmp(command)) return undefined;

		if (!ctx.hasUI) {
			// In non-interactive mode, block by default
			return { block: true, reason: "Dangerous command blocked (no UI for confirmation)" };
		}

		const choice = await ctx.ui.select(`Dangerous command:\n\n  ${command}\n\nAllow?`, ["Yes", "No"]);

		if (choice !== "Yes") {
			return { block: true, reason: "Blocked by user" };
		}

		return undefined;
	});
}
