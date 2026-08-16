import { chmod, mkdir, rename, rm, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";

const stateDir = "/tmp/pi-session-state";
const stateFile = `${stateDir}/${process.pid}.json`;

type SessionState = {
	pid: number;
	sessionId: string;
	sessionFile: string;
	cwd: string;
};

async function publish(ctx: ExtensionContext): Promise<void> {
	const sessionId = ctx.sessionManager.getSessionId();
	const sessionFile = ctx.sessionManager.getSessionFile();
	if (!sessionId || !sessionFile) return;

	const state: SessionState = {
		pid: process.pid,
		sessionId,
		sessionFile: resolve(sessionFile),
		cwd: resolve(ctx.sessionManager.getCwd()),
	};
	await mkdir(stateDir, { recursive: true, mode: 0o700 });
	await chmod(stateDir, 0o700);
	const temporary = `${stateFile}.${process.pid}.${Date.now()}.tmp`;
	await writeFile(temporary, `${JSON.stringify(state)}\n`, { mode: 0o600 });
	await chmod(temporary, 0o600);
	await rename(temporary, stateFile);
}

export default function (pi: ExtensionAPI): void {
	pi.on("session_start", async (_event, ctx) => {
		await publish(ctx);
	});
	pi.on("session_shutdown", async () => {
		await rm(stateFile, { force: true });
	});
}
