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
import { basename } from "node:path";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { canonicalPath } from "../protected-paths/path-policy.ts";

const dangerousPatterns = [/\brm\b[^\n;|&]*/i, /\bsudo\b/i, /\b(chmod|chown)\b[^\n;|&]*/i];
const shellSyntax = /[\n\r;|&<>`$(){}]/;

function tmpPrefixes(cwd: string): string[] { return ["/tmp", "/private/tmp", tmpdir()].map((path) => canonicalPath(path, cwd)).filter((path): path is string => Boolean(path)); }
function commandWords(command: string): string[] | undefined {
	if (shellSyntax.test(command)) return undefined;
	return command.trim().split(/\s+/).map((token) => token.replace(/^['"]|['"]$/g, "")).filter(Boolean);
}
export function isDangerous(command: string): boolean {
	const words = commandWords(command);
	if (!words?.length) return dangerousPatterns.some((pattern) => pattern.test(command));
	return ["sudo", "rm", "chmod", "chown"].includes(basename(words[0]!)) || dangerousPatterns.some((pattern) => pattern.test(command));
}
/** Only absolute, literal non-flag operands can receive the temp-directory exception. */
export function isConfinedToTmp(command: string, cwd = process.cwd()): boolean {
	const words = commandWords(command);
	const commandName = words?.[0] ? basename(words[0]) : "";
	if (!words?.length || commandName === "sudo" || !["rm", "chmod", "chown"].includes(commandName)) return false;
	const operands = words.slice(1).filter((word) => !word.startsWith("-"));
	if (!operands.length) return false;
	const paths = commandName === "rm" ? operands : operands.slice(1);
	const prefixes = tmpPrefixes(cwd);
	return paths.length > 0 && paths.every((path) => {
		if (!path.startsWith("/") || /[*?\[\]]/.test(path)) return false;
		const canonical = canonicalPath(path, cwd);
		return canonical !== undefined && prefixes.some((prefix) => canonical === prefix || canonical.startsWith(`${prefix}/`));
	});
}

export default function (pi: ExtensionAPI) {
	pi.on("tool_call", async (event, ctx) => {
		if (event.toolName !== "bash") return undefined;

		const command = event.input.command as string;
		if (!isDangerous(command)) return undefined;

		if (isConfinedToTmp(command, ctx.cwd)) return undefined;

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
