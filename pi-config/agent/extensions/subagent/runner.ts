import { spawn } from "node:child_process";

export const DEFAULT_TIMEOUT_MS = 30 * 60 * 1000;
export const MAX_EVENT_LINE_BYTES = 1024 * 1024;
export const MAX_STDERR_BYTES = 32 * 1024;
export const MAX_MESSAGES = 64;
export const MAX_ACTIVITY = 8;

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
	usage: UsageStats;
	model?: string;
	stopReason?: string;
	errorMessage?: string;
	retryAttempt?: number;
	startedAt: number;
	settled: boolean;
}

export function createRunnerState(model?: string): RunnerState {
	return {
		state: "starting",
		activity: [],
		messages: [],
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

function appendMessage(state: RunnerState, message: any) {
	state.messages.push(message);
	if (state.messages.length > MAX_MESSAGES) state.messages.splice(0, state.messages.length - MAX_MESSAGES);
}

function updateUsage(state: RunnerState, message: any) {
	if (message?.role !== "assistant") return;
	state.usage.turns++;
	const usage = message.usage;
	if (!usage) return;
	state.usage.input += usage.input || 0;
	state.usage.output += usage.output || 0;
	state.usage.cacheRead += usage.cacheRead || 0;
	state.usage.cacheWrite += usage.cacheWrite || 0;
	state.usage.cost += usage.cost?.total || 0;
	state.usage.contextTokens = usage.totalTokens || state.usage.contextTokens;
	if (!state.model && message.model) state.model = message.model;
	if (message.stopReason) state.stopReason = message.stopReason;
	if (message.errorMessage) state.errorMessage = message.errorMessage;
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
			state.activeTool = event.toolName || "tool";
			appendBounded(state.activity, `running ${state.activeTool}`, MAX_ACTIVITY);
			return true;
		case "tool_execution_update":
			state.activeTool = event.toolName || state.activeTool || "tool";
			return true;
		case "tool_execution_end":
			appendBounded(state.activity, `${event.isError ? "failed" : "finished"} ${event.toolName || state.activeTool || "tool"}`, MAX_ACTIVITY);
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
			state.retryAttempt = event.attempt || (state.retryAttempt || 0) + 1;
			appendBounded(state.activity, `retry ${state.retryAttempt} scheduled`, MAX_ACTIVITY);
			return true;
		case "auto_retry_end":
			state.state = "running";
			appendBounded(state.activity, `retry ${event.attempt || state.retryAttempt || 1} resumed`, MAX_ACTIVITY);
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

export class JsonlDecoder {
	private bufferedChunks: Buffer[] = [];
	private bufferedLength = 0;
	private discardingOversizedLine = false;
	private readonly maxLineBytes: number;
	rejectedLines = 0;
	constructor(maxLineBytes = MAX_EVENT_LINE_BYTES) { this.maxLineBytes = maxLineBytes; }
	get bufferedBytes(): number { return this.bufferedLength; }

	push(chunk: Buffer): unknown[] {
		const events: unknown[] = [];
		let offset = 0;
		while (offset < chunk.length) {
			const newline = chunk.indexOf(0x0a, offset);
			const end = newline === -1 ? chunk.length : newline;
			const segment = chunk.subarray(offset, end);
			if (!this.discardingOversizedLine) {
				const remaining = this.maxLineBytes - this.bufferedLength;
				if (segment.length > remaining) {
					this.clearBuffered();
					this.discardingOversizedLine = true;
					this.rejectedLines++;
				} else if (segment.length) {
					this.bufferedChunks.push(Buffer.from(segment));
					this.bufferedLength += segment.length;
				}
			}
			if (newline === -1) break;
			if (!this.discardingOversizedLine) this.parseBuffered(events);
			this.clearBuffered();
			this.discardingOversizedLine = false;
			offset = newline + 1;
		}
		return events;
	}

	finish(): unknown[] {
		const events: unknown[] = [];
		if (!this.discardingOversizedLine && this.bufferedLength) this.parseBuffered(events);
		this.clearBuffered();
		this.discardingOversizedLine = false;
		return events;
	}

	private clearBuffered() { this.bufferedChunks = []; this.bufferedLength = 0; }
	private parseBuffered(events: unknown[]) {
		const line = Buffer.concat(this.bufferedChunks, this.bufferedLength).toString("utf8");
		if (!line.trim()) return;
		try { events.push(JSON.parse(line)); } catch { this.rejectedLines++; }
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
				if (decoder.rejectedLines) protocolError = `Subagent emitted ${decoder.rejectedLines} malformed or oversized JSONL record(s).`;
				else if (terminalEvents !== 1) protocolError = `Subagent emitted ${terminalEvents} final agent_end event(s); expected exactly one.`;
				else if (settledEvents > 1) protocolError = `Subagent emitted ${settledEvents} agent_settled events; expected at most one.`;
				else if (eventAfterSettled) protocolError = "Subagent emitted data after its agent_settled event.";
			}
			resolve({ exitCode, stderr, reason, spawnError, protocolError });
		}
	});
}
