/**
 * Titlebar Spinner Extension
 *
 * Shows a braille spinner animation in the terminal title while the agent is working.
 * Uses `ctx.ui.setTitle()` to update the terminal title via the extension API.
 *
 * Usage:
 *   pi --extension examples/extensions/titlebar-spinner.ts
 */

import path from "node:path";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";

const BRAILLE_FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];

function getBaseTitle(pi: ExtensionAPI, ctx: ExtensionContext): string {
	const cwd = path.basename(ctx.sessionManager.getCwd());
	const session = pi.getSessionName();
	return session ? `π - ${session} - ${cwd}` : `π - ${cwd}`;
}

export default function (pi: ExtensionAPI) {
	let timer: ReturnType<typeof setInterval> | null = null;
	let frameIndex = 0;

	function stopAnimation(ctx: ExtensionContext) {
		if (timer) {
			clearInterval(timer);
			timer = null;
		}
		frameIndex = 0;
		ctx.ui.setTitle(getBaseTitle(pi, ctx));
	}

	function startAnimation(ctx: ExtensionContext) {
		stopAnimation(ctx);
		timer = setInterval(() => {
			const frame = BRAILLE_FRAMES[frameIndex % BRAILLE_FRAMES.length];
			ctx.ui.setTitle(`${frame} ${getBaseTitle(pi, ctx)}`);
			frameIndex++;
		}, 180);
	}

	pi.on("agent_start", async (_event, ctx) => {
		startAnimation(ctx);
	});

	pi.on("agent_settled", async (_event, ctx) => {
		stopAnimation(ctx);
	});

	pi.on("session_start", async (_event, ctx) => {
		if (!timer) ctx.ui.setTitle(getBaseTitle(pi, ctx));
	});

	pi.on("session_info_changed", async (_event, ctx) => {
		if (!timer) ctx.ui.setTitle(getBaseTitle(pi, ctx));
	});

	pi.on("session_shutdown", async (_event, ctx) => {
		stopAnimation(ctx);
	});
}
