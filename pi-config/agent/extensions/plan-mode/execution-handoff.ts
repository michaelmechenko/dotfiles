import { createHash, randomUUID } from "node:crypto";
import { chmodSync, existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import { processStartToken } from "../session-state/process-identity.ts";
import { basename, dirname, join, resolve } from "node:path";
import type { ModelSnapshot, PlanState } from "./plan-state.ts";
import { migratePlanState } from "./plan-state.ts";
import { isModelSnapshot } from "./config.ts";
import { spawnedPiCommand, splitDirectionArgs, type TmuxPaneDirection } from "../tmux/runtime.ts";

export interface TmuxTarget { session: string; window: string; pane: string; }
export interface ExecutionPacket { version: 2; plan: PlanState; source: { sessionId: string; cwd: string; tmuxSession: string }; model: ModelSnapshot; }
export interface ClaimedExecutionPacket extends ExecutionPacket { claimToken: string; }
export interface ExecutionClaim { path: string; token: string; }
type ClaimRecord = { pid: number; processStartedAt: string; token: string; planId: string; sourceSessionId: string; claimedAt: string; cancelled?: boolean; legacy?: boolean; };
type RecoveryRecord = { pid: number; processStartedAt: string; token: string; planId: string; sourceSessionId: string; deadClaimToken: string; reclaimedAt: string; predecessorToken?: string; };
type TerminalRecoveryRecord = { token: string; planId: string; sourceSessionId: string; deadClaimToken: string; finishedAt: string; };
type RecoveryResolution = { latest: RecoveryRecord; terminal: boolean } | "absent" | "invalid";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MAX_RECOVERY_CHAIN = 16;

export function renderPlanMarkdown(plan: PlanState): string {
	const lines = ["# Plan", "", "## Goal", plan.goal || "(not set)", "", "## Steps"];
	for (const step of plan.steps) lines.push(`${step.completed ? "- [x]" : step.skipped ? "- [-]" : "- [ ]"} ${step.text} _(id: ${step.id})_`);
	if (plan.criteria.length) lines.push("", "## Verification", ...plan.criteria.map((item) => `- ${item}`));
	if (plan.followUps.length) lines.push("", "## Follow-up work", ...plan.followUps.map((item) => `- ${item}`));
	lines.push("", "## Execution brief", "", "### Summary", plan.executionBrief.summary || "(not set)");
	if (plan.executionBrief.findings.length) lines.push("", "### Findings", ...plan.executionBrief.findings.map((item) => `- ${item}`));
	if (plan.executionBrief.decisions.length) lines.push("", "### Decisions", ...plan.executionBrief.decisions.map((item) => `- ${item}`));
	if (plan.executionBrief.relevantFiles.length) lines.push("", "### Relevant files", ...plan.executionBrief.relevantFiles.map((file) => `- \`${file.path}\` — ${file.note}`));
	if (plan.executionBrief.constraints.length) lines.push("", "### Constraints", ...plan.executionBrief.constraints.map((item) => `- ${item}`));
	return `${lines.join("\n")}\n`;
}
export function handoffDirectory(agentDir: string): string { return join(agentDir, "plan-handoffs"); }
export function writeExecutionPacket(agentDir: string, packet: ExecutionPacket): string {
	if (!isExecutionPacket(packet)) throw new Error("Invalid plan handoff packet.");
	const dir = handoffDirectory(agentDir); mkdirSync(dir, { recursive: true, mode: 0o700 }); chmodSync(dir, 0o700);
	const path = join(dir, `${Date.now()}-${process.pid}-${randomUUID()}.json`); const tmp = `${path}.tmp`;
	writeFileSync(tmp, JSON.stringify(packet), { encoding: "utf8", mode: 0o600 }); chmodSync(tmp, 0o600); renameSync(tmp, path); return path;
}
/** Deletes only records owned by a matching, nonempty ordinary claim token. */
export function deleteExecutionPacket(agentDir: string, handoffPath: string, claimToken: string): void {
	if (!isPrivatePath(agentDir, handoffPath) || !claimToken || existsSync(recoveryPath(handoffPath))) return;
	const packet = readPacket(handoffPath); const claim = packet && readClaim(handoffPath, packet);
	if (!claim || claim.token !== claimToken) return;
	for (const path of [handoffPath, claimPath(handoffPath), acknowledgementPath(handoffPath)]) if (isPrivatePath(agentDir, path)) try { unlinkSync(path); } catch { /* already cleaned */ }
}
/** Atomically claims an untouched packet. Recovery fences are never reused. */
export function consumeExecutionPacket(agentDir: string, handoffPath: string): ClaimedExecutionPacket | undefined {
	if (!isPrivatePath(agentDir, handoffPath) || !existsSync(handoffPath) || existsSync(recoveryPath(handoffPath))) return undefined;
	const token = randomUUID();
	try {
		const packet = readPacket(handoffPath); if (!packet) return undefined;
		const claim: ClaimRecord = { pid: process.pid, processStartedAt: processStartToken(), token, planId: packet.plan.planId ?? "", sourceSessionId: packet.source.sessionId, claimedAt: new Date().toISOString() };
		writeFileSync(claimPath(handoffPath), `${JSON.stringify(claim)}\n`, { encoding: "utf8", mode: 0o600, flag: "wx" });
		// The packet and our just-created claim must still describe the same owner.
		// A cancellation fence is intentionally never removed, so a reader delayed
		// between its first packet read and this wx cannot claim after cancellation.
		const confirmed = readPacket(handoffPath); const persisted = confirmed && readClaim(handoffPath, confirmed);
		if (!confirmed || !persisted || persisted.token !== token) {
			// We may clean only the exact token written above. A cancellation fence
			// cannot have this token because it won the same atomic wx instead.
			if (readClaimRecord(claimPath(handoffPath))?.token === token) try { unlinkSync(claimPath(handoffPath)); } catch { /* cleanup raced */ }
			return undefined;
		}
		return { ...confirmed, claimToken: token };
	} catch { return undefined; }
}
/** Readiness and cleanup are claim-token fenced, so a stale caller cannot affect a successor. */
export function acknowledgeExecutionPacket(agentDir: string, handoffPath: string, claimToken: string): boolean {
	const path = acknowledgementPath(handoffPath); const packet = readPacket(handoffPath); const claim = packet && readClaim(handoffPath, packet);
	if (!isPrivatePath(agentDir, handoffPath) || !isPrivatePath(agentDir, path) || !claim || claim.token !== claimToken) return false;
	try { writeFileSync(path, `${claim.token}\n`, { encoding: "utf8", mode: 0o600, flag: "wx" }); return true; } catch { return validAcknowledgement(path, claim); }
}
/** True only for the live process instance that owns this packet and persisted claim. */
export function validateExecutionClaim(agentDir: string, executionClaim: ExecutionClaim, expected?: { planId?: string; sourceSessionId?: string }): boolean {
	if (!executionClaim.token || !isPrivatePath(agentDir, executionClaim.path)) return false;
	const packet = readPacket(executionClaim.path); const claim = packet && readClaim(executionClaim.path, packet);
	return Boolean(packet && claim && claim.token === executionClaim.token && claimInstance(claim.pid, claim.processStartedAt) === "live" && claim.pid === process.pid && claim.processStartedAt === processStartToken() && (!expected?.planId || packet.plan.planId === expected.planId) && (!expected?.sourceSessionId || packet.source.sessionId === expected.sourceSessionId));
}
export type ExecutionAcknowledgement = "ready" | "claimed" | "unclaimed";
export type ExecutionOwner = "ready" | "live" | "dead" | "unknown";
/** Reports the latest recovery claimant too, including a verified dead claimant. */
export function executionOwner(agentDir: string, handoffPath: string): ExecutionOwner {
	if (!isPrivatePath(agentDir, handoffPath)) return "unknown";
	const packet = readPacket(handoffPath); const claim = packet && readClaim(handoffPath, packet);
	if (!packet || !claim || claim.cancelled) return "unknown";
	const recovery = resolveRecovery(handoffPath, packet, claim);
	if (recovery === "invalid") return "unknown";
	if (recovery !== "absent") return claimInstance(recovery.latest.pid, recovery.latest.processStartedAt);
	const instance = claimInstance(claim.pid, claim.processStartedAt);
	return instance === "live" ? (validAcknowledgement(acknowledgementPath(handoffPath), claim) ? "ready" : "live") : instance;
}
/**
 * Atomically records recovery ownership. Successors are immutable files named for
 * their predecessor token, so contenders cannot unlink or replace each other.
 */
export function reclaimDeadExecutionPacket(agentDir: string, handoffPath: string): string | undefined {
	if (!isPrivatePath(agentDir, handoffPath)) return undefined;
	const packet = readPacket(handoffPath); const dead = packet && readClaim(handoffPath, packet);
	if (!packet || !dead || !dead.planId || dead.planId !== packet.plan.planId || dead.sourceSessionId !== packet.source.sessionId || claimInstance(dead.pid, dead.processStartedAt) !== "dead") return undefined;
	const currentStart = processStartToken();
	for (let attempt = 0; attempt < 2; attempt++) {
		const chain = resolveRecovery(handoffPath, packet, dead);
		if (chain === "invalid") return undefined;
		if (chain !== "absent") {
			const latest = chain.latest;
			if (latest.pid === process.pid && latest.processStartedAt === currentStart) return latest.token;
			if (claimInstance(latest.pid, latest.processStartedAt) !== "dead") return undefined;
			const successor: RecoveryRecord = { pid: process.pid, processStartedAt: currentStart, token: randomUUID(), planId: dead.planId, sourceSessionId: dead.sourceSessionId, deadClaimToken: dead.token, reclaimedAt: new Date().toISOString(), predecessorToken: latest.token };
			try { writePrivateJson(successorRecoveryPath(handoffPath, latest.token), successor); return successor.token; } catch { continue; }
		}
		const root: RecoveryRecord = { pid: process.pid, processStartedAt: currentStart, token: randomUUID(), planId: dead.planId, sourceSessionId: dead.sourceSessionId, deadClaimToken: dead.token, reclaimedAt: new Date().toISOString() };
		try { writePrivateJson(recoveryPath(handoffPath), root); return root.token; } catch { continue; }
	}
	return undefined;
}
/** Token-fenced cleanup keeps the immutable recovery chain as a terminal fence. */
export function finishRecoveredExecutionPacket(agentDir: string, handoffPath: string, recoveryToken: string): boolean {
	if (!isPrivatePath(agentDir, handoffPath) || !recoveryToken) return false;
	const packet = readPacket(handoffPath); const claim = packet && readClaim(handoffPath, packet);
	const chain = resolveRecovery(handoffPath, packet, claim);
	if (chain === "absent" || chain === "invalid" || chain.latest.token !== recoveryToken || chain.latest.pid !== process.pid || chain.latest.processStartedAt !== processStartToken()) return false;
	if (!chain.terminal) {
		const terminal: TerminalRecoveryRecord = { token: chain.latest.token, planId: chain.latest.planId, sourceSessionId: chain.latest.sourceSessionId, deadClaimToken: chain.latest.deadClaimToken, finishedAt: new Date().toISOString() };
		try { writePrivateJson(terminalRecoveryPath(handoffPath, chain.latest.token), terminal); } catch {
			const reread = resolveRecovery(handoffPath, packet, claim);
			if (reread === "absent" || reread === "invalid" || !reread.terminal || reread.latest.token !== recoveryToken) return false;
		}
	}
	// The terminal fence is durable before mutable packet files are removed; retries
	// after a process crash are safe and stale predecessor tokens cannot pass above.
	for (const path of [handoffPath, `${handoffPath}.reclaiming`, claimPath(handoffPath), acknowledgementPath(handoffPath)]) try { unlinkSync(path); } catch { /* already cleaned */ }
	return true;
}
/** Explicit reconciliation is only for state persisted after cleanup but before final state write. */
export function recoveredExecutionPacketFinished(agentDir: string, handoffPath: string, token: string, planId: string, sourceSessionId: string): boolean {
	if (!isPrivatePath(agentDir, handoffPath) || !token || !planId || !sourceSessionId) return false;
	const chain = resolveRecovery(handoffPath);
	if (chain === "absent" || chain === "invalid" || !chain.terminal || chain.latest.token !== token || chain.latest.planId !== planId || chain.latest.sourceSessionId !== sourceSessionId) return false;
	const packet = readPacket(handoffPath);
	if (packet && (packet.plan.planId !== planId || packet.source.sessionId !== sourceSessionId)) return false;
	const claim = readClaimRecord(claimPath(handoffPath));
	if (claim && (claim.planId !== planId || claim.sourceSessionId !== sourceSessionId || claim.token !== chain.latest.deadClaimToken)) return false;
	// A terminal tombstone is the durable authorization for idempotent cleanup.
	// This handles a crash after any individual unlink, including packet first.
	for (const path of [handoffPath, `${handoffPath}.reclaiming`, claimPath(handoffPath), acknowledgementPath(handoffPath)]) try { unlinkSync(path); } catch { /* already cleaned */ }
	return !existsSync(handoffPath) && !existsSync(claimPath(handoffPath));
}
/** Atomically fence an unclaimed packet before returning ownership to the source. */
export function cancelUnclaimedExecutionPacket(agentDir: string, handoffPath: string): boolean {
	const claim = claimPath(handoffPath);
	if (!isPrivatePath(agentDir, handoffPath) || !isPrivatePath(agentDir, claim) || existsSync(recoveryPath(handoffPath))) return false;
	try { writeFileSync(claim, `${JSON.stringify({ cancelled: true, pid: process.pid, processStartedAt: processStartToken(), token: randomUUID(), planId: "", sourceSessionId: "", claimedAt: new Date().toISOString() })}\n`, { encoding: "utf8", mode: 0o600, flag: "wx" }); } catch { return false; }
	// Do not delete the cancellation claim. It is an immutable fence against a
	// consumer which read the packet before cancellation but has not claimed yet.
	try { unlinkSync(handoffPath); } catch { /* already cleaned */ }
	try { unlinkSync(acknowledgementPath(handoffPath)); } catch { /* already cleaned */ }
	return true;
}
export async function waitForExecutionAcknowledgement(agentDir: string, handoffPath: string, timeoutMs = 5_000): Promise<ExecutionAcknowledgement> {
	if (!isPrivatePath(agentDir, handoffPath)) return "unclaimed";
	const until = Date.now() + timeoutMs;
	while (Date.now() < until) { const packet = readPacket(handoffPath); const claim = packet && readClaim(handoffPath, packet); if (claim && validAcknowledgement(acknowledgementPath(handoffPath), claim)) return "ready"; await new Promise((resolve) => setTimeout(resolve, 25)); }
	const owner = executionOwner(agentDir, handoffPath); return owner === "live" || owner === "ready" ? "claimed" : "unclaimed";
}
function readPacket(path: string): ExecutionPacket | undefined {
	try {
		// Legacy recovery renamed the private packet; only explicit recovery reads
		// this tombstone. consume still requires the original packet to exist.
		const storedPath = existsSync(path) ? path : `${path}.reclaiming`;
		const stat = lstatSync(storedPath); if (!stat.isFile() || (stat.mode & 0o077) !== 0) return undefined;
		const value = JSON.parse(readFileSync(storedPath, "utf8")) as Partial<ExecutionPacket>;
		const plan = migratePlanState(value.plan);
		if (!plan || value.version !== 2 || !isModelSnapshot(value.model) || !isSource(value.source)) return undefined;
		return { version: 2, plan, source: value.source, model: value.model };
	} catch { return undefined; }
}
function readClaim(handoffPath: string, packet: ExecutionPacket): ClaimRecord | undefined {
	try {
		const path = claimPath(handoffPath); const stat = lstatSync(path); if (!stat.isFile() || (stat.mode & 0o077) !== 0) return undefined;
		const raw = readFileSync(path, "utf8"); const value = JSON.parse(raw) as Partial<ClaimRecord>;
		const ordinary = readClaimValue(value);
		if (ordinary) return ordinary;
		// v6-era claims omitted token/source. Bind their deterministic compatibility
		// token to both the immutable claim bytes and private packet identity.
		const planId = packet.plan.planId;
		if (typeof value.pid === "number" && Number.isInteger(value.pid) && value.pid > 0 && typeof value.processStartedAt === "string" && value.processStartedAt && typeof value.claimedAt === "string" && value.token === undefined && value.planId === undefined && value.sourceSessionId === undefined && planId) return { pid: value.pid, processStartedAt: value.processStartedAt, claimedAt: value.claimedAt, token: legacyClaimToken(handoffPath, raw, packet), planId, sourceSessionId: packet.source.sessionId, legacy: true };
		return undefined;
	} catch { return undefined; }
}
function readClaimRecord(path: string): ClaimRecord | undefined {
	try { const stat = lstatSync(path); if (!stat.isFile() || (stat.mode & 0o077) !== 0) return undefined; return readClaimValue(JSON.parse(readFileSync(path, "utf8")) as Partial<ClaimRecord>); } catch { return undefined; }
}
function readClaimValue(value: Partial<ClaimRecord>): ClaimRecord | undefined {
	if (typeof value.pid !== "number" || !Number.isInteger(value.pid) || value.pid <= 0 || typeof value.processStartedAt !== "string" || !value.processStartedAt || typeof value.claimedAt !== "string") return undefined;
	return typeof value.token === "string" && value.token.length > 0 && typeof value.planId === "string" && typeof value.sourceSessionId === "string" && value.sourceSessionId.length > 0 ? { ...value, pid: value.pid, processStartedAt: value.processStartedAt, claimedAt: value.claimedAt, token: value.token, planId: value.planId, sourceSessionId: value.sourceSessionId } : undefined;
}
function resolveRecovery(handoffPath: string, packet?: ExecutionPacket, claim?: ClaimRecord): RecoveryResolution {
	const rootPath = recoveryPath(handoffPath);
	if (!existsSync(rootPath)) return "absent";
	const root = readRecovery(rootPath); if (!root || root.predecessorToken !== undefined) return "invalid";
	if (packet && claim && !matchesRecovery(root, packet, claim)) return "invalid";
	let latest = root; const allowed = new Set<string>([basename(rootPath)]);
	for (let depth = 0; depth < MAX_RECOVERY_CHAIN; depth++) {
		const successorPath = successorRecoveryPath(handoffPath, latest.token); const terminalPath = terminalRecoveryPath(handoffPath, latest.token);
		const terminalExists = existsSync(terminalPath);
		if (terminalExists) {
			const terminal = readTerminal(terminalPath); if (!terminal || !matchesTerminal(terminal, latest)) return "invalid";
			allowed.add(basename(terminalPath));
		}
		if (!existsSync(successorPath)) return listedRecoveryFilesAreSafe(handoffPath, allowed) ? { latest, terminal: terminalExists } : "invalid";
		allowed.add(basename(successorPath)); const successor = readRecovery(successorPath);
		if (!successor || successor.predecessorToken !== latest.token || successor.planId !== root.planId || successor.sourceSessionId !== root.sourceSessionId || successor.deadClaimToken !== root.deadClaimToken) return "invalid";
		latest = successor;
	}
	return "invalid";
}
function listedRecoveryFilesAreSafe(handoffPath: string, allowed: Set<string>): boolean {
	try {
		const prefix = `${basename(handoffPath)}.reclaim.`;
		for (const name of readdirSync(dirname(handoffPath))) if (name.startsWith(prefix) && !allowed.has(name)) return false;
		return true;
	} catch { return false; }
}
function matchesRecovery(record: RecoveryRecord, packet: ExecutionPacket, claim: ClaimRecord): boolean { return record.planId === packet.plan.planId && record.sourceSessionId === packet.source.sessionId && record.deadClaimToken === claim.token; }
function readRecovery(path: string): RecoveryRecord | undefined {
	try { const stat = lstatSync(path); if (!stat.isFile() || (stat.mode & 0o077) !== 0) return undefined; const value = JSON.parse(readFileSync(path, "utf8")) as Partial<RecoveryRecord>; return typeof value.pid === "number" && Number.isInteger(value.pid) && value.pid > 0 && typeof value.processStartedAt === "string" && value.processStartedAt.length > 0 && typeof value.token === "string" && UUID.test(value.token) && typeof value.planId === "string" && value.planId.length > 0 && typeof value.sourceSessionId === "string" && value.sourceSessionId.length > 0 && typeof value.deadClaimToken === "string" && value.deadClaimToken.length > 0 && typeof value.reclaimedAt === "string" && (value.predecessorToken === undefined || (typeof value.predecessorToken === "string" && UUID.test(value.predecessorToken))) ? value as RecoveryRecord : undefined; } catch { return undefined; }
}
function readTerminal(path: string): TerminalRecoveryRecord | undefined {
	try { const stat = lstatSync(path); if (!stat.isFile() || (stat.mode & 0o077) !== 0) return undefined; const value = JSON.parse(readFileSync(path, "utf8")) as Partial<TerminalRecoveryRecord>; return typeof value.token === "string" && UUID.test(value.token) && typeof value.planId === "string" && typeof value.sourceSessionId === "string" && typeof value.deadClaimToken === "string" && typeof value.finishedAt === "string" ? value as TerminalRecoveryRecord : undefined; } catch { return undefined; }
}
function matchesTerminal(terminal: TerminalRecoveryRecord, recovery: RecoveryRecord): boolean { return terminal.token === recovery.token && terminal.planId === recovery.planId && terminal.sourceSessionId === recovery.sourceSessionId && terminal.deadClaimToken === recovery.deadClaimToken; }
function writePrivateJson(path: string, value: unknown): void { writeFileSync(path, `${JSON.stringify(value)}\n`, { encoding: "utf8", mode: 0o600, flag: "wx" }); }
function validAcknowledgement(path: string, claim: ClaimRecord): boolean { try { const stat = lstatSync(path); if (!stat.isFile() || (stat.mode & 0o077) !== 0) return false; const value = readFileSync(path, "utf8"); return value === `${claim.token}\n` || (claim.legacy === true && value === "consumed\n"); } catch { return false; } }
function legacyClaimToken(handoffPath: string, rawClaim: string, packet: ExecutionPacket): string { return createHash("sha256").update(`${handoffPath}\0${rawClaim}\0${packet.plan.planId}\0${packet.source.sessionId}`).digest("hex"); }
function claimInstance(pid: number, startedAt: string): "live" | "dead" | "unknown" { try { process.kill(pid, 0); } catch (error) { return (error as NodeJS.ErrnoException).code === "ESRCH" ? "dead" : "unknown"; } const current = processStartToken(pid); return current ? current === startedAt ? "live" : "dead" : "unknown"; }
function claimPath(handoffPath: string): string { return `${handoffPath}.claim`; }
function acknowledgementPath(handoffPath: string): string { return `${handoffPath}.ack`; }
function recoveryPath(handoffPath: string): string { return `${handoffPath}.reclaim`; }
function successorRecoveryPath(handoffPath: string, predecessorToken: string): string { return `${recoveryPath(handoffPath)}.${predecessorToken}`; }
function terminalRecoveryPath(handoffPath: string, token: string): string { return `${recoveryPath(handoffPath)}.${token}.done`; }
function handoffEnvironment(handoffPath: string, model: ModelSnapshot): string[] { if (!isModelSnapshot(model)) throw new Error("Invalid execution model."); return ["-e", `PI_PLAN_HANDOFF=${handoffPath}`, "-e", `PI_PLAN_PROVIDER=${model.provider}`, "-e", `PI_PLAN_MODEL=${model.model}`, "-e", `PI_PLAN_THINKING=${model.thinkingLevel}`]; }
function handoffCommand(): string { return spawnedPiCommand("pi --provider \"$PI_PLAN_PROVIDER\" --model \"$PI_PLAN_MODEL\" --thinking \"$PI_PLAN_THINKING\""); }
export function buildTmuxNewWindowArgs(target: TmuxTarget, cwd: string, handoffPath: string, model: ModelSnapshot): string[] { return ["new-window", "-d", "-t", target.session, "-c", cwd, ...handoffEnvironment(handoffPath, model), handoffCommand()]; }
export function buildTmuxDetachedPaneArgs(target: TmuxTarget, cwd: string, handoffPath: string, model: ModelSnapshot, direction: TmuxPaneDirection = "below"): string[] { return ["split-window", "-d", splitDirectionArgs(direction), "-t", target.pane, "-c", cwd, ...handoffEnvironment(handoffPath, model), handoffCommand()]; }
function isPrivatePath(agentDir: string, candidate: string): boolean { const dir = resolve(handoffDirectory(agentDir)); const path = resolve(candidate); return dirname(path) === dir && !basename(path).includes(".."); }
function isSource(value: unknown): value is ExecutionPacket["source"] { return !!value && typeof value === "object" && typeof (value as ExecutionPacket["source"]).sessionId === "string" && typeof (value as ExecutionPacket["source"]).cwd === "string" && typeof (value as ExecutionPacket["source"]).tmuxSession === "string"; }
function isExecutionPacket(value: unknown): value is ExecutionPacket { if (!value || typeof value !== "object") return false; const packet = value as Partial<ExecutionPacket>; return packet.version === 2 && isModelSnapshot(packet.model) && isSource(packet.source) && Boolean(migratePlanState(packet.plan)); }
