import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { randomUUID } from "node:crypto";

export const RESULT_ARTIFACT_RETENTION_MS = 7 * 24 * 60 * 60 * 1000;
export const MAX_RESULT_ARTIFACTS = 64;
const RETENTION_LOCK_ATTEMPTS = 100;
const RETENTION_LOCK_WAIT_MS = 10;

export interface ResultArtifact {
	path: string;
	bytes: number;
}

export interface CapturedOutput {
	preview: string;
	truncated: boolean;
	artifact?: ResultArtifact;
	artifactError?: string;
}

export type OutputCapture = (output: string) => CapturedOutput;

function truncateUtf8(text: string, cap: number): string {
	if (Buffer.byteLength(text, "utf8") <= cap) return text;
	let clipped = text.slice(0, cap);
	while (Buffer.byteLength(clipped, "utf8") > cap) clipped = clipped.slice(0, -1);
	return clipped;
}

function artifactRoot(): string {
	const stateHome = process.env.XDG_STATE_HOME || path.join(os.homedir(), ".local", "state");
	return path.join(stateHome, "pi", "subagent-results");
}

function sleepSync(milliseconds: number): void {
	Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, milliseconds);
}

function withRetentionLock<T>(dir: string, operation: () => T): T {
	const lockPath = path.join(dir, ".retention.lock");
	for (let attempt = 0; attempt < RETENTION_LOCK_ATTEMPTS; attempt++) {
		const token = randomUUID();
		const candidatePath = path.join(dir, `.retention-owner-${process.pid}-${token}`);
		fs.writeFileSync(candidatePath, JSON.stringify({ token, pid: process.pid }), { mode: 0o600, flag: "wx" });
		try {
			fs.linkSync(candidatePath, lockPath);
		} catch (error) {
			fs.rmSync(candidatePath, { force: true });
			if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
			// Never steal an existing lock: POSIX has no compare-and-unlink primitive,
			// so stale-owner recovery can race with a newly published live lock.
			sleepSync(RETENTION_LOCK_WAIT_MS);
			continue;
		}
		try { fs.rmSync(candidatePath, { force: true }); } catch { /* lock publication already succeeded */ }
		try { return operation(); }
		finally {
			try {
				const owner = JSON.parse(fs.readFileSync(lockPath, "utf8"));
				if (owner.token === token) fs.rmSync(lockPath, { force: true });
			} catch { /* a dead-owner recovery replaced this ownership token */ }
		}
	}
	throw new Error("Timed out waiting for the subagent result-retention lock.");
}

function pruneArtifacts(dir: string, protectedPath?: string, now = Date.now()): void {
	let entries: fs.Dirent[];
	try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
	const files = entries.filter((entry) => entry.isFile() && entry.name.startsWith("result-")).flatMap((entry) => {
		const filePath = path.join(dir, entry.name);
		try {
			const mtimeMs = fs.statSync(filePath).mtimeMs;
			const match = /^result-(\d{13})-(\d+)-/.exec(entry.name);
			const orderKey = match ? `${match[1]}-${match[2].padStart(24, "0")}` : `${String(Math.floor(mtimeMs)).padStart(13, "0")}-${entry.name}`;
			return [{ path: filePath, mtimeMs, orderKey }];
		} catch { return []; }
	});
	const current = protectedPath ? files.find((entry) => entry.path === protectedPath) : undefined;
	const candidates = files.filter((entry) => entry.path !== protectedPath);
	const retained = candidates.filter((entry) => now - entry.mtimeMs <= RESULT_ARTIFACT_RETENTION_MS).sort((left, right) => right.orderKey.localeCompare(left.orderKey));
	const expired = candidates.filter((entry) => now - entry.mtimeMs > RESULT_ARTIFACT_RETENTION_MS);
	const otherLimit = Math.max(0, MAX_RESULT_ARTIFACTS - (current ? 1 : 0));
	for (const entry of [...expired, ...retained.slice(otherLimit)]) fs.rmSync(entry.path, { force: true });
}

/** Prepare a private retained-output writer. Small outputs remain memory-only. */
export async function prepareOutputCapture(agentName: string, visibleBytes: number): Promise<OutputCapture> {
	const dir = artifactRoot();
	await fs.promises.mkdir(dir, { recursive: true, mode: 0o700 });
	await fs.promises.chmod(dir, 0o700);
	try { withRetentionLock(dir, () => pruneArtifacts(dir)); } catch { /* a stale lock must not prevent child execution */ }
	const safe = agentName.replace(/[^\w.-]+/g, "_").slice(0, 48) || "agent";
	let currentArtifactPath: string | undefined;

	return (output: string): CapturedOutput => {
		const bytes = Buffer.byteLength(output, "utf8");
		if (bytes <= visibleBytes) {
			if (currentArtifactPath) {
				try { withRetentionLock(dir, () => fs.rmSync(currentArtifactPath!, { force: true })); } catch { /* retention cleanup must not break result delivery */ }
				currentArtifactPath = undefined;
			}
			return { preview: output, truncated: false };
		}
		const preview = truncateUtf8(output, visibleBytes);
		const artifactPath = path.join(dir, `result-${Date.now()}-${process.hrtime.bigint()}-${process.pid}-${randomUUID()}-${safe}.md`);
		try {
			withRetentionLock(dir, () => {
				if (currentArtifactPath) fs.rmSync(currentArtifactPath, { force: true });
				fs.writeFileSync(artifactPath, output, { encoding: "utf8", mode: 0o600, flag: "wx" });
				currentArtifactPath = artifactPath;
				pruneArtifacts(dir, artifactPath);
			});
			return { preview, truncated: true, artifact: { path: artifactPath, bytes } };
		} catch (error) {
			return { preview, truncated: true, artifactError: error instanceof Error ? error.message : String(error) };
		}
	};
}
