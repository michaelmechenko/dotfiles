/**
 * Plan file persistence for plan mode.
 *
 * Writes/reads plan steps to/from a markdown file so plans survive
 * restarts, model switches, and manual editing.
 *
 * File path: <agentDir>/plans/<session-hash>.md
 */

import { existsSync, mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { type TodoItem, parsePlanEditText } from "./utils.ts";

/** Derive a safe filename slug from a session hash or project path. */
function planSlug(sessionId: string): string {
	// Collapse non-alphanumeric to dashes, strip leading/trailing dashes
	return sessionId
		.replace(/[^a-zA-Z0-9_-]/g, "-")
		.replace(/-+/g, "-")
		.replace(/^-|-$/g, "")
		.toLowerCase();
}

/** Get the plans directory, creating it if needed. */
function ensurePlansDir(agentDir: string): string {
	const dir = join(agentDir, "plans");
	if (!existsSync(dir)) {
		mkdirSync(dir, { recursive: true });
	}
	return dir;
}

/** Full path to the plan file for a given session id. */
export function planFilePath(agentDir: string, sessionId: string): string {
	return join(ensurePlansDir(agentDir), `${planSlug(sessionId)}.md`);
}

/** Serialize a plan to markdown. */
export function serializePlan(todos: TodoItem[]): string {
	if (todos.length === 0) return "";

	const lines = ["## Plan", ""];
	for (const t of todos) {
		const prefix = t.completed ? "- [x]" : t.skipped ? "- [-]" : "- [ ]";
		lines.push(`${prefix} ${t.text}`);
	}
	lines.push("");
	return lines.join("\n");
}

/** Write plan file atomically (temp + rename). */
export function writePlanFile(agentDir: string, sessionId: string, todos: TodoItem[]): void {
	if (todos.length === 0) return;
	const filePath = planFilePath(agentDir, sessionId);
	const tmpPath = filePath + ".tmp";
	writeFileSync(tmpPath, serializePlan(todos), "utf-8");
	renameSync(tmpPath, filePath);
}

/** Delete a completed or discarded plan file. */
export function deletePlanFile(agentDir: string, sessionId: string): void {
	const filePath = planFilePath(agentDir, sessionId);
	if (existsSync(filePath)) unlinkSync(filePath);
}

/** Read a plan file back into TodoItem[], preserving completion/skip status. */
export function readPlanFile(agentDir: string, sessionId: string): TodoItem[] {
	const filePath = planFilePath(agentDir, sessionId);
	if (!existsSync(filePath)) return [];

	const content = readFileSync(filePath, "utf-8");

	// Parse checklist syntax: "- [ ] step text", "- [x] done", "- [-] skipped"
	const items: TodoItem[] = [];
	const linePattern = /^\s*-\s+\[([ xX-])\]\s+(.+)$/gm;

	for (const match of content.matchAll(linePattern)) {
		const marker = match[1];
		const text = match[2].trim();
		if (!text) continue;
		items.push({
			step: items.length + 1,
			text,
			completed: marker === "x" || marker === "X",
			skipped: marker === "-",
		});
	}

	if (items.length === 0) {
		// Fallback: parse as numbered list (old-style plan text)
		const texts = parsePlanEditText(content);
		return texts.map((text, i) => ({ step: i + 1, text, completed: false, skipped: false }));
	}

	return items;
}
