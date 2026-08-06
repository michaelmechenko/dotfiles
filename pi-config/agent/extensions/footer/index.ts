/**
 * Custom Footer Extension
 *
 * Mirrors pi's built-in footer (dist/modes/interactive/components/footer.js)
 * line for line, with three deliberate deviations:
 *
 * 1. The bottom line shows only context usage and the right-aligned
 *    model/provider/thinking display; token, cache, cache-hit, and cost stats
 *    are intentionally omitted to keep the footer quiet.
 * 2. The top line's left side shows `directory (origin/branch) (worktree/name)`
 *    instead of just `directory (branch)` -- origin/branch comes from the
 *    configured upstream (`git rev-parse --abbrev-ref --symbolic-full-name @{u}`),
 *    falling back to the plain branch name if there's no upstream; the worktree
 *    segment only appears when cwd is actually inside a linked git worktree.
 * 3. The top line's right side shows the `lsp` and `plan-mode` extensions'
 *    status text (if any) instead of leaving that space empty -- and those
 *    statuses are excluded from the generic bottom extension-status lines
 *    so they aren't shown twice.
 *
 * The whole footer renders in one uniform color (`dim`) -- the built-in footer
 * colors context% orange/red past 70%/90%; this one doesn't, by request.
 */

import { execFile } from "node:child_process";
import path from "node:path";
import { promisify } from "node:util";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";

const execFileAsync = promisify(execFile);

/** Matches built-in FooterComponent's formatTokens exactly. */
function formatTokens(count: number): string {
	if (count < 1000) return count.toString();
	if (count < 10000) return `${(count / 1000).toFixed(1)}k`;
	if (count < 1000000) return `${Math.round(count / 1000)}k`;
	if (count < 10000000) return `${(count / 1000000).toFixed(1)}M`;
	return `${Math.round(count / 1000000)}M`;
}

/** Matches built-in FooterComponent's formatCwdForFooter exactly. */
function formatCwdForFooter(cwd: string, home: string | undefined): string {
	if (!home) return cwd;
	const resolvedCwd = path.resolve(cwd);
	const resolvedHome = path.resolve(home);
	const relativeToHome = path.relative(resolvedHome, resolvedCwd);
	const isInsideHome =
		relativeToHome === "" ||
		(relativeToHome !== ".." && !relativeToHome.startsWith(`..${path.sep}`) && !path.isAbsolute(relativeToHome));
	if (!isInsideHome) return cwd;
	return relativeToHome === "" ? "~" : `~${path.sep}${relativeToHome}`;
}

async function runGit(cwd: string, args: string[]): Promise<string | null> {
	try {
		const { stdout } = await execFileAsync("git", args, { cwd, timeout: 2000 });
		const trimmed = stdout.trim();
		return trimmed.length > 0 ? trimmed : null;
	} catch {
		return null;
	}
}

interface GitExtra {
	originBranch: string | null;
	worktreeName: string | null;
}

/** Resolve "origin/branch" (from the configured upstream) and the linked worktree name, if any. */
async function resolveGitExtra(cwd: string): Promise<GitExtra> {
	const [originBranch, gitDir, commonDir] = await Promise.all([
		runGit(cwd, ["rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{u}"]),
		runGit(cwd, ["rev-parse", "--git-dir"]),
		runGit(cwd, ["rev-parse", "--git-common-dir"]),
	]);

	let worktreeName: string | null = null;
	if (gitDir && commonDir) {
		const resolvedGitDir = path.resolve(cwd, gitDir);
		const resolvedCommonDir = path.resolve(cwd, commonDir);
		if (resolvedGitDir !== resolvedCommonDir) {
			worktreeName = resolvedGitDir.match(/[/\\]worktrees[/\\]([^/\\]+)$/)?.[1] ?? path.basename(cwd);
		}
	}

	return { originBranch, worktreeName };
}

function columns(left: string, right: string, width: number): string {
	if (!right) return truncateToWidth(left, width);

	const naturalGap = width - visibleWidth(left) - visibleWidth(right);
	if (naturalGap >= 1) return `${left}${" ".repeat(naturalGap)}${right}`;

	const leftWidth = Math.max(1, Math.floor(width * 0.45));
	const rightWidth = Math.max(1, width - leftWidth - 1);
	const fittedLeft = truncateToWidth(left, leftWidth);
	const fittedRight = truncateToWidth(right, rightWidth);
	const gap = Math.max(1, width - visibleWidth(fittedLeft) - visibleWidth(fittedRight));
	return truncateToWidth(`${fittedLeft}${" ".repeat(gap)}${fittedRight}`, width);
}

function sanitizeStatusText(text: string): string {
	return text
		.replace(/[\r\n\t]/g, " ")
		.replace(/ +/g, " ")
		.trim();
}

export default function footer(pi: ExtensionAPI) {
	function install(ctx: ExtensionContext) {
		if (ctx.mode !== "tui") return;

		let gitExtra: GitExtra = { originBranch: null, worktreeName: null };
		resolveGitExtra(ctx.cwd).then((resolved) => {
			gitExtra = resolved;
		});

		ctx.ui.setFooter((tui, theme, footerData) => {
			const unsub = footerData.onBranchChange(async () => {
				gitExtra = await resolveGitExtra(ctx.cwd);
				tui.requestRender();
			});

			return {
				dispose: unsub,
				invalidate() {},
				render(width: number): string[] {
					// --- Top line: directory (origin/branch) (worktree/name) ... lsp/plan-mode status ---
					let pwd = formatCwdForFooter(ctx.sessionManager.getCwd(), process.env.HOME || process.env.USERPROFILE);

					const branch = footerData.getGitBranch();
					if (branch) {
						pwd = `${pwd} (${gitExtra.originBranch ?? branch})`;
					}
					if (gitExtra.worktreeName) {
						pwd = `${pwd} (worktree/${gitExtra.worktreeName})`;
					}

					const sessionName = ctx.sessionManager.getSessionName();
					if (sessionName) {
						pwd = `${pwd} \u2022 ${sessionName}`;
					}

					const statuses = footerData.getExtensionStatuses();
					const lspStatus = statuses.get("lsp");
					const planStatus = statuses.get("plan-mode");
					const topRight = [lspStatus, planStatus]
						.filter((s): s is string => Boolean(s))
						.map(sanitizeStatusText)
						.join(" \u2022 ");
					const topLine = truncateToWidth(
						theme.fg("dim", columns(pwd, topRight, width)),
						width,
						theme.fg("dim", "..."),
					);

					// --- Bottom line: context usage only ---
					const contextUsage = ctx.getContextUsage();
					const contextWindow = contextUsage?.contextWindow ?? ctx.model?.contextWindow ?? 0;
					const contextPercentValue = contextUsage?.percent ?? 0;
					const contextPercent = contextUsage?.percent !== null ? contextPercentValue.toFixed(1) : "?";
					const autoIndicator = " (auto)";
					const statsLeft =
						contextPercent === "?"
							? `?/${formatTokens(contextWindow)}${autoIndicator}`
							: `${contextPercent}%/${formatTokens(contextWindow)}${autoIndicator}`;
					const statsLeftWidth = visibleWidth(statsLeft);

					const minPadding = 2;
					const modelName = ctx.model?.id || "no-model";
					let rightSideWithoutProvider = modelName;
					const thinkingLevel = pi.getThinkingLevel();
					if (ctx.model?.reasoning) {
						rightSideWithoutProvider =
							thinkingLevel === "off" ? `${modelName} \u2022 thinking off` : `${modelName} \u2022 ${thinkingLevel}`;
					}

					let rightSide = rightSideWithoutProvider;
					if (footerData.getAvailableProviderCount() > 1 && ctx.model) {
						rightSide = `(${ctx.model.provider}) ${rightSideWithoutProvider}`;
						if (statsLeftWidth + minPadding + visibleWidth(rightSide) > width) {
							rightSide = rightSideWithoutProvider;
						}
					}

					const rightSideWidth = visibleWidth(rightSide);
					const totalNeeded = statsLeftWidth + minPadding + rightSideWidth;
					let statsLine: string;
					if (totalNeeded <= width) {
						statsLine = statsLeft + " ".repeat(width - statsLeftWidth - rightSideWidth) + rightSide;
					} else {
						const availableForRight = width - statsLeftWidth - minPadding;
						if (availableForRight > 0) {
							const truncatedRight = truncateToWidth(rightSide, availableForRight, "");
							const truncatedRightWidth = visibleWidth(truncatedRight);
							statsLine =
								statsLeft + " ".repeat(Math.max(0, width - statsLeftWidth - truncatedRightWidth)) + truncatedRight;
						} else {
							statsLine = statsLeft;
						}
					}

					const lines = [topLine, theme.fg("dim", statsLine)];

					const statusLines = Array.from(statuses.entries())
						.filter(([key]) => key !== "lsp" && key !== "plan-mode")
						.sort(([a], [b]) => a.localeCompare(b))
						.map(([, text]) => sanitizeStatusText(text));
					if (statusLines.length > 0) {
						lines.push(theme.fg("dim", truncateToWidth(statusLines.join(" "), width, "...")));
					}

					return lines;
				},
			};
		});
	}

	pi.on("session_start", (_event, ctx) => install(ctx));

	pi.on("session_shutdown", (_event, ctx) => {
		if (ctx.mode === "tui") ctx.ui.setFooter(undefined);
	});

	pi.registerCommand("builtin-footer", {
		description: "Restore built-in footer",
		handler: async (_args, ctx) => {
			ctx.ui.setFooter(undefined);
			ctx.ui.notify("Built-in footer restored", "info");
		},
	});
}
