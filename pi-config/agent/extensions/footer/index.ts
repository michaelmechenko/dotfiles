/**
 * Custom Footer Extension
 *
 * Mirrors pi's built-in footer (dist/modes/interactive/components/footer.js)
 * line for line, with three deliberate deviations:
 *
 * 1. The bottom-left stats line groups `\u2191/\u2193` tokens, `R/W` cache, `CH`/cost,
 *    and context% with " \u2022 " separators instead of running them together.
 * 2. The top line's left side shows `directory (origin/branch) (worktree/name)`
 *    instead of just `directory (branch)` -- origin/branch comes from the
 *    configured upstream (`git rev-parse --abbrev-ref --symbolic-full-name @{u}`),
 *    falling back to the plain branch name if there's no upstream; the worktree
 *    segment only appears when cwd is actually inside a linked git worktree.
 * 2. The top line's right side shows the `lsp` extension's status text (if any)
 *    instead of leaving that space empty -- and that status is excluded from
 *    the generic bottom extension-status lines so it isn't shown twice.
 *
 * Everything else (token/cache/cost math, right-aligned model/provider/thinking,
 * extension status lines) matches the built-in footer's logic and formatting
 * exactly, except the whole footer renders in one uniform color (`dim`) --
 * the built-in footer colors context% orange/red past 70%/90%; this one
 * doesn't, by request.
 */

import { execFile } from "node:child_process";
import path from "node:path";
import { promisify } from "node:util";
import type { AssistantMessage } from "@earendil-works/pi-ai";
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
					// --- Top line: directory (origin/branch) (worktree/name) ... lsp status ---
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
					const topLine = truncateToWidth(
						theme.fg("dim", columns(pwd, lspStatus ? sanitizeStatusText(lspStatus) : "", width)),
						width,
						theme.fg("dim", "..."),
					);

					// --- Bottom-left stats, grouped with separators ---
					let totalInput = 0;
					let totalOutput = 0;
					let totalCacheRead = 0;
					let totalCacheWrite = 0;
					let totalCost = 0;
					let latestCacheHitRate: number | undefined;

					for (const entry of ctx.sessionManager.getEntries()) {
						if (entry.type === "message" && entry.message.role === "assistant") {
							const message = entry.message as AssistantMessage;
							totalInput += message.usage.input;
							totalOutput += message.usage.output;
							totalCacheRead += message.usage.cacheRead;
							totalCacheWrite += message.usage.cacheWrite;
							totalCost += message.usage.cost.total;
							const latestPromptTokens = message.usage.input + message.usage.cacheRead + message.usage.cacheWrite;
							latestCacheHitRate = latestPromptTokens > 0 ? (message.usage.cacheRead / latestPromptTokens) * 100 : undefined;
						}
					}

					const contextUsage = ctx.getContextUsage();
					const contextWindow = contextUsage?.contextWindow ?? ctx.model?.contextWindow ?? 0;
					const contextPercentValue = contextUsage?.percent ?? 0;
					const contextPercent = contextUsage?.percent !== null ? contextPercentValue.toFixed(1) : "?";

					const tokenGroup: string[] = [];
					if (totalInput) tokenGroup.push(`\u2191${formatTokens(totalInput)}`);
					if (totalOutput) tokenGroup.push(`\u2193${formatTokens(totalOutput)}`);

					const cacheGroup: string[] = [];
					if (totalCacheRead) cacheGroup.push(`R${formatTokens(totalCacheRead)}`);
					if (totalCacheWrite) cacheGroup.push(`W${formatTokens(totalCacheWrite)}`);

					const costGroup: string[] = [];
					if ((totalCacheRead > 0 || totalCacheWrite > 0) && latestCacheHitRate !== undefined) {
						costGroup.push(`CH${latestCacheHitRate.toFixed(1)}%`);
					}
					const usingSubscription = ctx.model ? ctx.modelRegistry.isUsingOAuth(ctx.model) : false;
					if (totalCost || usingSubscription) {
						costGroup.push(`$${totalCost.toFixed(3)}${usingSubscription ? " (sub)" : ""}`);
					}

					const autoIndicator = " (auto)";
					const contextPercentDisplay =
						contextPercent === "?"
							? `?/${formatTokens(contextWindow)}${autoIndicator}`
							: `${contextPercent}%/${formatTokens(contextWindow)}${autoIndicator}`;

					const contextGroup = [contextPercentDisplay];

					const groups = [tokenGroup, cacheGroup, costGroup, contextGroup].filter((g) => g.length > 0);
					let statsLeft = groups.map((g) => g.join(" ")).join(" \u2022 ");

					let statsLeftWidth = visibleWidth(statsLeft);
					if (statsLeftWidth > width) {
						statsLeft = truncateToWidth(statsLeft, width, "...");
						statsLeftWidth = visibleWidth(statsLeft);
					}

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
						.filter(([key]) => key !== "lsp")
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
