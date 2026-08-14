/**
 * Finder / ForkLift Extension
 *
 * Registers an `open_in_finder` tool so the model can surface a referenced
 * local path in macOS Finder or ForkLift. When ForkLift.app is installed,
 * reveals/open the path via ForkLift's AppleScript `reveal` command (files
 * are revealed-and-selected in their parent folder, directories open as a
 * tab); otherwise falls back to Finder (`open` for directories, `open -R`
 * for files). If the AppleScript call fails, it also falls back to Finder.
 *
 * Paths may be `@`-prefixed, `~`-home-relative, absolute, or relative to the
 * session cwd. Existence is validated before either app is invoked, since
 * ForkLift's `reveal` is a silent no-op on missing paths.
 *
 * Neither path invokes a shell: ForkLift via `/usr/bin/osascript` with an
 * argv array, Finder via `/usr/bin/open` with an argv array. No dependency on
 * Oh My Zsh, tmux, or shell aliases. The tool only acts when explicitly
 * requested -- it never opens paths autonomously.
 */

import { spawn } from "node:child_process";
import { stat } from "node:fs/promises";
import { homedir } from "node:os";
import { resolve, isAbsolute } from "node:path";

import { Type } from "@earendil-works/pi-ai";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

const OPEN_BINARY = "/usr/bin/open";
const OSASCRIPT_BINARY = "/usr/bin/osascript";
const FORKLIFT_APP_PATH = "/Applications/ForkLift.app";

/** Resolve a user-supplied path the same way built-in tools do: strip a leading @, expand ~, make absolute against cwd. */
function resolveTarget(rawPath: string, cwd: string): string {
	let path = rawPath.trim();
	if (path.startsWith("@")) path = path.slice(1).trim();
	if (path === "~") return homedir();
	if (path.startsWith("~/")) return resolve(homedir(), path.slice(2));
	if (isAbsolute(path)) return path;
	return resolve(cwd, path);
}

/** Escape a path for safe embedding inside an AppleScript double-quoted string literal. */
function escapeAppleScriptString(value: string): string {
	return value.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

/** Whether ForkLift.app is installed. Probed once at extension load and cached for all calls. */
let forkLiftInstalled: boolean | undefined;

async function detectForkLift(): Promise<boolean> {
	if (forkLiftInstalled !== undefined) return forkLiftInstalled;
	try {
		await stat(FORKLIFT_APP_PATH);
		forkLiftInstalled = true;
	} catch {
		forkLiftInstalled = false;
	}
	return forkLiftInstalled;
}

/**
 * Reveal/open `target` in ForkLift via AppleScript `reveal`.
 * Resolves on exit code 0; rejects with stderr (or a spawn error message) on failure.
 * Does not activate/steal focus -- `reveal` alone navigates the active tab without raising the window.
 */
function revealInForkLift(target: string, signal: AbortSignal | undefined): Promise<void> {
	const script = `tell application "ForkLift" to reveal path "${escapeAppleScriptString(target)}"`;
	return new Promise<void>((promiseResolve, promiseReject) => {
		const child = spawn(OSASCRIPT_BINARY, ["-e", script], { stdio: "ignore" });
		const onAbort = () => {
			child.kill("SIGTERM");
		};
		if (signal) {
			if (signal.aborted) {
				child.kill("SIGTERM");
			} else {
				signal.addEventListener("abort", onAbort, { once: true });
			}
		}
		child.once("error", (error) => {
			if (signal) signal.removeEventListener("abort", onAbort);
			promiseReject(error);
		});
		child.once("close", (code, signalName) => {
			if (signal) signal.removeEventListener("abort", onAbort);
			if (code === 0) promiseResolve();
			else promiseReject(new Error(`osascript exited with code ${code ?? "null"}${signalName ? ` (signal ${signalName})` : ""}`));
		});
	});
}

/** Open/reveal `target` in Finder via /usr/bin/open (directory -> open, file -> open -R). */
function openInFinder(target: string, isDir: boolean, signal: AbortSignal | undefined): Promise<void> {
	const args = isDir ? [target] : ["-R", target];
	return new Promise<void>((promiseResolve, promiseReject) => {
		const child = spawn(OPEN_BINARY, args, { stdio: "ignore" });
		const onAbort = () => {
			child.kill("SIGTERM");
		};
		if (signal) {
			if (signal.aborted) {
				child.kill("SIGTERM");
			} else {
				signal.addEventListener("abort", onAbort, { once: true });
			}
		}
		child.once("error", (error) => {
			if (signal) signal.removeEventListener("abort", onAbort);
			promiseReject(error);
		});
		child.once("close", (code) => {
			if (signal) signal.removeEventListener("abort", onAbort);
			if (code === 0) promiseResolve();
			else promiseReject(new Error(`open exited with code ${code}`));
		});
	});
}

export default function finderExtension(pi: ExtensionAPI) {
	// Probe ForkLift presence once at load; result is cached for all tool calls.
	void detectForkLift();

	pi.registerTool({
		name: "open_in_finder",
		label: "Open in Finder",
		description:
			"Open a local file or directory in macOS Finder, or in ForkLift when ForkLift.app is installed. Directories open in a new pane/tab; files are revealed and selected in their parent folder. Use this when the user asks to open, show, or reveal a file/folder in Finder (the tool routes to ForkLift automatically when present, falling back to Finder otherwise). Accepts @-prefixed, ~-home-relative, absolute, or cwd-relative paths. Does not edit or read file contents.",
		promptSnippet: "Open a local file or directory in macOS Finder (or ForkLift when installed)",
		promptGuidelines: [
			"Use open_in_finder when the user asks to open, show, or reveal a file or folder in Finder (e.g. \"open this folder in Finder\"). Pass the referenced path; do not call it for remote paths or URLs. ForkLift is used automatically when installed, Finder otherwise.",
		],
		parameters: Type.Object({
			path: Type.String({
				description: "Local path to open in Finder. May be @-prefixed, ~-home-relative, absolute, or relative to the cwd. Directories are opened; files are revealed and selected.",
			}),
		}),

		async execute(_toolCallId, params, signal, _onUpdate, ctx) {
			if (process.platform !== "darwin") {
				throw new Error("open_in_finder is only available on macOS");
			}

			const target = resolveTarget(params.path, ctx.cwd);

			let stats;
			try {
				stats = await stat(target);
			} catch {
				throw new Error(`Path does not exist: ${target}`);
			}

			const isDir = stats.isDirectory();

			// Prefer ForkLift when installed; fall back to Finder on any failure.
			if (await detectForkLift()) {
				try {
					await revealInForkLift(target, signal);
					return {
						content: [
							{
								type: "text",
								text: isDir
									? `Opened folder in ForkLift: ${target}`
									: `Revealed file in ForkLift: ${target}`,
							},
						],
						details: { path: target, kind: isDir ? "directory" : "file", app: "forklift" },
					};
				} catch {
					// Fall through to Finder.
				}
			}

			await openInFinder(target, isDir, signal);
			return {
				content: [
					{
						type: "text",
						text: isDir
							? `Opened folder in Finder: ${target}`
							: `Revealed file in Finder: ${target}`,
					},
				],
				details: { path: target, kind: isDir ? "directory" : "file", app: "finder" },
			};
		},
	});
}