import { spawn } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import type { OutputCapture, ResultArtifact } from "./result-artifacts.ts";

export const DEFAULT_TIMEOUT_MS = 30 * 60 * 1000;
export const MAX_EVENT_LINE_BYTES = 1024 * 1024;
export const MAX_ACCEPTED_EVENT_LINE_BYTES = 16 * 1024 * 1024;
export const MAX_STDERR_BYTES = 32 * 1024;
export const MAX_MESSAGES = 16;
export const MAX_MESSAGE_BYTES = 8 * 1024;
export const MAX_RETAINED_MESSAGE_BYTES = 32 * 1024;
export const MAX_ACTIVITY = 8;
export const MAX_PROTOCOL_ISSUES = 8;
export const MAX_METADATA_BYTES = 1024;
export const MAX_ERROR_BYTES = 8 * 1024;

export interface UsageStats {
	input: number;
	output: number;
	cacheRead: number;
	cacheWrite: number;
	cost: number;
	contextTokens: number;
	turns: number;
}

export type RunState = "starting" | "running" | "retrying" | "completed" | "failed" | "aborted" | "timed_out";

export interface RunnerState {
	state: RunState;
	activeTool?: string;
	activity: string[];
	messages: any[];
	messageBytes: number;
	finalOutput: string;
	outputTruncated: boolean;
	outputArtifact?: ResultArtifact;
	outputArtifactError?: string;
	captureOutput?: OutputCapture;
	usage: UsageStats;
	model?: string;
	stopReason?: string;
	errorMessage?: string;
	retryAttempt?: number;
	startedAt: number;
	settled: boolean;
}

export function createRunnerState(model?: string, captureOutput?: OutputCapture): RunnerState {
	return {
		state: "starting",
		activity: [],
		messages: [],
		messageBytes: 0,
		finalOutput: "",
		outputTruncated: false,
		captureOutput,
		usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cost: 0, contextTokens: 0, turns: 0 },
		model,
		startedAt: Date.now(),
		settled: false,
	};
}

function appendBounded(items: string[], value: string, limit: number) {
	if (!value) return;
	items.push(value.replace(/\s+/g, " ").slice(0, 180));
	if (items.length > limit) items.splice(0, items.length - limit);
}

function boundedString(value: unknown, cap = MAX_METADATA_BYTES): string | undefined {
	return typeof value === "string" ? truncateUtf8(value, cap) : undefined;
}

function boundedNumber(value: unknown): number {
	return typeof value === "number" && Number.isFinite(value) && value >= 0 ? Math.min(value, Number.MAX_SAFE_INTEGER) : 0;
}

function projectedUsage(value: any): Record<string, unknown> | undefined {
	if (!value || typeof value !== "object") return undefined;
	return {
		input: boundedNumber(value.input),
		output: boundedNumber(value.output),
		cacheRead: boundedNumber(value.cacheRead),
		cacheWrite: boundedNumber(value.cacheWrite),
		totalTokens: boundedNumber(value.totalTokens),
		cost: { total: boundedNumber(value.cost?.total) },
	};
}

function projectedMessage(message: any): any {
	if (!message || typeof message !== "object") return { role: "unknown" };
	const projected: Record<string, unknown> = { role: boundedString(message.role) ?? "unknown" };
	for (const key of ["provider", "model", "api", "stopReason"] as const) {
		const value = boundedString(message[key]);
		if (value !== undefined) projected[key] = value;
	}
	const errorMessage = boundedString(message.errorMessage, MAX_ERROR_BYTES);
	if (errorMessage !== undefined) projected.errorMessage = errorMessage;
	const usage = projectedUsage(message.usage);
	if (usage) projected.usage = usage;
	if (typeof message.timestamp === "number" && Number.isFinite(message.timestamp)) projected.timestamp = message.timestamp;
	if (!Array.isArray(message.content)) return projected;
	let remaining = MAX_MESSAGE_BYTES;
	const content: Array<Record<string, unknown>> = [];
	for (const part of message.content) {
		if (!part || typeof part !== "object" || remaining <= 0) continue;
		if (part.type === "text" && typeof part.text === "string") {
			const text = truncateUtf8(part.text, remaining);
			remaining -= Buffer.byteLength(text, "utf8");
			content.push({ type: "text", text });
			continue;
		}
		if (part.type === "thinking" && typeof part.thinking === "string") {
			const thinking = truncateUtf8(part.thinking, remaining);
			remaining -= Buffer.byteLength(thinking, "utf8");
			content.push({ type: "thinking", thinking });
			continue;
		}
		if (part.type === "toolCall") {
			const candidate = { type: "toolCall", id: boundedString(part.id), name: boundedString(part.name) };
			const bytes = Buffer.byteLength(JSON.stringify(candidate), "utf8");
			if (bytes <= remaining) {
				content.push(candidate);
				remaining -= bytes;
			}
		}
	}
	projected.content = content;
	return projected;
}

function appendMessage(state: RunnerState, message: any) {
	const projected = projectedMessage(message);
	const bytes = Buffer.byteLength(JSON.stringify(projected), "utf8");
	state.messages.push(projected);
	state.messageBytes += bytes;
	while (state.messages.length > MAX_MESSAGES || state.messageBytes > MAX_RETAINED_MESSAGE_BYTES) {
		const removed = state.messages.shift();
		if (removed !== undefined) state.messageBytes -= Buffer.byteLength(JSON.stringify(removed), "utf8");
	}
}

function assistantOutput(message: any): string {
	if (message?.role !== "assistant" || !Array.isArray(message.content)) return "";
	return message.content.filter((part: any) => part?.type === "text" && typeof part.text === "string").map((part: any) => part.text).join("\n");
}

function updateUsage(state: RunnerState, message: any) {
	if (message?.role !== "assistant") return;
	const output = assistantOutput(message);
	if (output) {
		const captured = state.captureOutput?.(output) ?? { preview: truncateUtf8(output, MAX_MESSAGE_BYTES), truncated: Buffer.byteLength(output, "utf8") > MAX_MESSAGE_BYTES };
		state.finalOutput = captured.preview;
		state.outputTruncated = captured.truncated;
		state.outputArtifact = captured.artifact;
		state.outputArtifactError = captured.artifactError;
	}
	state.usage.turns++;
	const usage = message.usage;
	if (usage && typeof usage === "object") {
		state.usage.input += boundedNumber(usage.input);
		state.usage.output += boundedNumber(usage.output);
		state.usage.cacheRead += boundedNumber(usage.cacheRead);
		state.usage.cacheWrite += boundedNumber(usage.cacheWrite);
		state.usage.cost += boundedNumber(usage.cost?.total);
		state.usage.contextTokens = boundedNumber(usage.totalTokens) || state.usage.contextTokens;
	}
	if (!state.model) state.model = boundedString(message.model);
	state.stopReason = boundedString(message.stopReason) ?? state.stopReason;
	state.errorMessage = boundedString(message.errorMessage, MAX_ERROR_BYTES) ?? state.errorMessage;
}

/** Reduce Pi JSON-mode events into a small, display-oriented state. */
export function reduceEvent(state: RunnerState, event: any): boolean {
	if (!event || typeof event.type !== "string") return false;
	switch (event.type) {
		case "agent_start":
			state.state = "running";
			appendBounded(state.activity, "agent started", MAX_ACTIVITY);
			return true;
		case "tool_execution_start":
			state.state = "running";
			state.activeTool = boundedString(event.toolName) || "tool";
			appendBounded(state.activity, `running ${state.activeTool}`, MAX_ACTIVITY);
			return true;
		case "tool_execution_update":
			state.activeTool = boundedString(event.toolName) || state.activeTool || "tool";
			return true;
		case "tool_execution_end":
			appendBounded(state.activity, `${event.isError ? "failed" : "finished"} ${boundedString(event.toolName) || state.activeTool || "tool"}`, MAX_ACTIVITY);
			state.activeTool = undefined;
			return true;
		case "message_update":
			if (event.assistantMessageEvent?.type === "text_delta") appendBounded(state.activity, "writing response", MAX_ACTIVITY);
			return true;
		case "message_end":
			appendMessage(state, event.message);
			updateUsage(state, event.message);
			return true;
		case "auto_retry_start":
			state.state = "retrying";
			state.retryAttempt = boundedNumber(event.attempt) || (state.retryAttempt || 0) + 1;
			appendBounded(state.activity, `retry ${state.retryAttempt} scheduled`, MAX_ACTIVITY);
			return true;
		case "auto_retry_end":
			state.state = "running";
			appendBounded(state.activity, `retry ${boundedNumber(event.attempt) || state.retryAttempt || 1} resumed`, MAX_ACTIVITY);
			state.retryAttempt = undefined;
			return true;
		case "agent_end":
			appendBounded(state.activity, "agent turn ended", MAX_ACTIVITY);
			return true;
		case "agent_settled":
			state.settled = true;
			if (state.state !== "retrying" && state.state !== "aborted" && state.state !== "timed_out") {
				state.state = state.stopReason === "error" ? "failed" : "completed";
			}
			return true;
		default:
			return false;
	}
}

export interface JsonlIssue {
	record: number;
	bytes: number;
	kind: "malformed" | "oversized" | "transport";
}

export class JsonlDecoder {
	private bufferedChunks: Buffer[] = [];
	private bufferedLength = 0;
	private lineBytes = 0;
	private discardingOversizedLine = false;
	private transportFailure = false;
	private spillDir?: string;
	private spillPath?: string;
	private spillFd?: number;
	private records = 0;
	private readonly maxLineBytes: number;
	private readonly maxAcceptedLineBytes: number;
	readonly issues: JsonlIssue[] = [];
	malformedLines = 0;
	oversizedLines = 0;
	transportLines = 0;
	constructor(maxLineBytes = MAX_EVENT_LINE_BYTES, maxAcceptedLineBytes = MAX_ACCEPTED_EVENT_LINE_BYTES) {
		this.maxLineBytes = maxLineBytes;
		this.maxAcceptedLineBytes = Math.max(maxLineBytes, maxAcceptedLineBytes);
	}
	get bufferedBytes(): number { return this.bufferedLength; }
	get rejectedLines(): number { return this.malformedLines + this.oversizedLines + this.transportLines; }

	push(chunk: Buffer): unknown[] {
		const events: unknown[] = [];
		let offset = 0;
		while (offset < chunk.length) {
			const newline = chunk.indexOf(0x0a, offset);
			const end = newline === -1 ? chunk.length : newline;
			this.appendSegment(chunk.subarray(offset, end));
			if (newline === -1) break;
			this.finishLine(events);
			offset = newline + 1;
		}
		return events;
	}

	finish(): unknown[] {
		const events: unknown[] = [];
		if (this.lineBytes || this.discardingOversizedLine || this.transportFailure || this.spillFd !== undefined) this.finishLine(events);
		this.dispose();
		return events;
	}

	dispose(): void {
		this.closeSpill();
		if (this.spillDir) {
			try { fs.rmSync(this.spillDir, { recursive: true, force: true }); } catch { /* best-effort private temp cleanup */ }
		}
		this.spillDir = undefined;
	}

	private appendSegment(segment: Buffer): void {
		if (!segment.length) return;
		this.lineBytes += segment.length;
		if (this.discardingOversizedLine || this.transportFailure) return;
		if (this.lineBytes > this.maxAcceptedLineBytes) {
			this.discardingOversizedLine = true;
			this.clearStorage();
			return;
		}
		if (this.spillFd !== undefined) {
			try { fs.writeSync(this.spillFd, segment); }
			catch { this.transportFailure = true; this.clearStorage(); }
			return;
		}
		if (this.bufferedLength + segment.length <= this.maxLineBytes) {
			this.bufferedChunks.push(Buffer.from(segment));
			this.bufferedLength += segment.length;
			return;
		}
		if (!this.openSpill()) {
			this.bufferedChunks.push(Buffer.from(segment));
			this.bufferedLength += segment.length;
			return;
		}
		try {
			for (const chunk of this.bufferedChunks) fs.writeSync(this.spillFd as number, chunk);
			fs.writeSync(this.spillFd as number, segment);
			this.bufferedChunks = [];
			this.bufferedLength = 0;
		} catch {
			this.cleanupSpill();
			this.bufferedChunks.push(Buffer.from(segment));
			this.bufferedLength += segment.length;
		}
	}

	private finishLine(events: unknown[]): void {
		if (!this.lineBytes && !this.discardingOversizedLine && this.spillFd === undefined) return;
		this.records++;
		if (this.transportFailure) {
			this.transportLines++;
			this.recordIssue("transport");
			this.resetLine();
			return;
		}
		if (this.discardingOversizedLine) {
			this.oversizedLines++;
			this.recordIssue("oversized");
			this.resetLine();
			return;
		}
		let data: Buffer;
		if (this.spillFd !== undefined && this.spillPath) {
			this.closeSpill();
			try {
				data = fs.readFileSync(this.spillPath);
				fs.rmSync(this.spillPath, { force: true });
				this.spillPath = undefined;
			} catch {
				this.transportLines++;
				this.recordIssue("transport");
				this.resetLine();
				return;
			}
		} else {
			data = Buffer.concat(this.bufferedChunks, this.bufferedLength);
		}
		try {
			const parsed = JSON.parse(data.toString("utf8"));
			// Large agent_end records duplicate the complete message history already
			// emitted as message_end events. Retain only terminal protocol metadata.
			if (data.length > this.maxLineBytes && parsed?.type === "agent_end") {
				events.push({ type: "agent_end", willRetry: parsed.willRetry });
			} else {
				events.push(parsed);
			}
		} catch {
			this.malformedLines++;
			this.recordIssue("malformed");
		}
		this.resetLine();
	}

	private recordIssue(kind: JsonlIssue["kind"]): void {
		if (this.issues.length < MAX_PROTOCOL_ISSUES) this.issues.push({ record: this.records, bytes: this.lineBytes, kind });
	}

	private openSpill(): boolean {
		try {
			if (!this.spillDir) {
				this.spillDir = fs.mkdtempSync(path.join(os.tmpdir(), "pi-subagent-jsonl-"));
				fs.chmodSync(this.spillDir, 0o700);
			}
			this.spillPath = path.join(this.spillDir, `record-${this.records + 1}.json`);
			this.spillFd = fs.openSync(this.spillPath, "wx", 0o600);
			return true;
		} catch {
			this.cleanupSpill();
			return false;
		}
	}

	private closeSpill(): void {
		if (this.spillFd === undefined) return;
		try { fs.closeSync(this.spillFd); } catch { /* record handling reports transport failures */ }
		this.spillFd = undefined;
	}

	private cleanupSpill(): void {
		this.closeSpill();
		if (this.spillPath) {
			try { fs.rmSync(this.spillPath, { force: true }); } catch { /* best effort */ }
		}
		this.spillPath = undefined;
	}

	private clearStorage(): void {
		this.bufferedChunks = [];
		this.bufferedLength = 0;
		this.cleanupSpill();
	}

	private resetLine(): void {
		this.clearStorage();
		this.lineBytes = 0;
		this.discardingOversizedLine = false;
		this.transportFailure = false;
	}
}

export function truncateUtf8(text: string, cap: number): string {
	if (Buffer.byteLength(text, "utf8") <= cap) return text;
	let clipped = text.slice(0, cap);
	while (Buffer.byteLength(clipped, "utf8") > cap) clipped = clipped.slice(0, -1);
	return clipped;
}

export function appendOutputBounded(current: string, chunk: Buffer, cap = MAX_STDERR_BYTES): string {
	const prefix = "[stderr truncated]\n";
	const combined = current + chunk.toString("utf8");
	if (Buffer.byteLength(combined, "utf8") <= cap) return combined;
	const tailCap = Math.max(0, cap - Buffer.byteLength(prefix));
	let text = combined.slice(-tailCap);
	while (Buffer.byteLength(text, "utf8") > tailCap) text = text.slice(1);
	return prefix + text;
}

function terminateProcessTree(pid: number | undefined, signal: NodeJS.Signals) {
	if (!pid) return;
	try {
		if (process.platform !== "win32") process.kill(-pid, signal);
		else process.kill(pid, signal);
	} catch { /* process already exited */ }
}

export interface SpawnedRun {
	command: string;
	args: string[];
	cwd: string;
	signal?: AbortSignal;
	timeoutMs?: number;
	killGraceMs?: number;
	onEvent: (event: unknown) => void;
}

export interface SpawnedResult { exitCode: number; stderr: string; reason?: "aborted" | "timed_out"; spawnError?: string; protocolError?: string }

/** Spawn one owned Pi child with bounded output and deterministic cancellation cleanup. */
export async function runSpawnedJsonl(options: SpawnedRun): Promise<SpawnedResult> {
	return new Promise((resolve) => {
		let stderr = "";
		let finished = false;
		let reason: SpawnedResult["reason"];
		let killTimer: NodeJS.Timeout | undefined;
		let terminalEvents = 0;
		let settledEvents = 0;
		let eventAfterSettled = false;
		const decoder = new JsonlDecoder();
		const acceptEvent = (event: unknown) => {
			if (settledEvents) eventAfterSettled = true;
			if (typeof event === "object" && event !== null) {
				const record = event as { type?: unknown; willRetry?: unknown };
				if (record.type === "agent_end" && record.willRetry !== true) terminalEvents++;
				if (record.type === "agent_settled") settledEvents++;
			}
			options.onEvent(event);
		};
		const proc = spawn(options.command, options.args, { cwd: options.cwd, shell: false, detached: process.platform !== "win32", stdio: ["ignore", "pipe", "pipe"] });
		const terminate = (why: NonNullable<SpawnedResult["reason"]>) => {
			if (finished || reason) return;
			reason = why;
			terminateProcessTree(proc.pid, "SIGTERM");
			killTimer = setTimeout(() => terminateProcessTree(proc.pid, "SIGKILL"), options.killGraceMs ?? 5000);
			killTimer.unref();
		};
		const abortListener = () => terminate("aborted");
		const timeout = setTimeout(() => terminate("timed_out"), options.timeoutMs ?? DEFAULT_TIMEOUT_MS);
		if (options.signal?.aborted) abortListener();
		else options.signal?.addEventListener("abort", abortListener, { once: true });
		proc.stdout.on("data", (chunk: Buffer) => decoder.push(chunk).forEach(acceptEvent));
		proc.stderr.on("data", (chunk: Buffer) => { stderr = appendOutputBounded(stderr, chunk); });
		proc.on("error", (error) => finish(1, error.message));
		proc.on("close", (code) => {
			decoder.finish().forEach(acceptEvent);
			finish(code ?? 1);
		});
		function finish(exitCode: number, spawnError?: string) {
			if (finished) return;
			finished = true;
			clearTimeout(timeout);
			if (killTimer && !reason) clearTimeout(killTimer);
			options.signal?.removeEventListener("abort", abortListener);
			let protocolError: string | undefined;
			if (!reason && !spawnError && exitCode === 0) {
				if (decoder.rejectedLines) {
					const samples = decoder.issues.map((issue) => `record ${issue.record}: ${issue.kind}, ${issue.bytes} bytes`).join("; ");
					const omitted = decoder.rejectedLines - decoder.issues.length;
					protocolError = `Subagent rejected ${decoder.malformedLines} malformed, ${decoder.oversizedLines} oversized, and ${decoder.transportLines} transport-failed JSONL record(s): ${samples}${omitted > 0 ? `; ${omitted} more` : ""}.`;
				} else if (terminalEvents !== 1) protocolError = `Subagent emitted ${terminalEvents} final agent_end event(s); expected exactly one.`;
				else if (settledEvents > 1) protocolError = `Subagent emitted ${settledEvents} agent_settled events; expected at most one.`;
				else if (eventAfterSettled) protocolError = "Subagent emitted data after its agent_settled event.";
			}
			decoder.dispose();
			resolve({ exitCode, stderr, reason, spawnError, protocolError });
		}
	});
}
