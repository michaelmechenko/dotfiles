/**
 * apply_patch — Multi-file patch engine.
 *
 * One call can add, update, delete, or move multiple files.
 * Uses replace.ts cascading replacer for oldText → newText matching.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { replace } from "./replace.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ApplyPatchChange {
	/** Absolute path to the file. */
	path: string;
	action: "add" | "update" | "delete" | "move";
	/** Content for new files (action=add). */
	content?: string;
	/** Text to find for updates (action=update). */
	oldText?: string;
	/** Replacement text for updates (action=update). */
	newText?: string;
	/** Destination path for moves (action=move). */
	movePath?: string;
}

export interface ApplyPatchResult {
	ok: boolean;
	applied: AppliedChange[];
	errors: ApplyPatchError[];
}

export interface AppliedChange {
	path: string;
	action: ApplyPatchChange["action"];
	bytes?: number;
	diff?: string;
	movePath?: string;
	oldContent?: string;
	newContent?: string;
}

export interface ApplyPatchError {
	path: string;
	action: string;
	error: string;
}

// ---------------------------------------------------------------------------
// Atomic file write
// ---------------------------------------------------------------------------

async function atomicWriteFile(filePath: string, content: string): Promise<void> {
	const dir = path.dirname(filePath);
	const tmp = path.join(dir, `.${path.basename(filePath)}.pi-apply-patch.${process.pid}.tmp`);
	await fs.promises.writeFile(tmp, content, "utf8");
	await fs.promises.rename(tmp, filePath);
}

// ---------------------------------------------------------------------------
// Individual change handlers
// ---------------------------------------------------------------------------

async function handleAdd(change: ApplyPatchChange): Promise<AppliedChange> {
	const content = change.content ?? "";
	// Ensure trailing newline
	const final = content.endsWith("\n") ? content : `${content}\n`;

	// Create parent directories
	const dir = path.dirname(change.path);
	await fs.promises.mkdir(dir, { recursive: true });

	await atomicWriteFile(change.path, final);

	return {
		path: change.path,
		action: "add",
		bytes: Buffer.byteLength(final, "utf8"),
		newContent: final,
	};
}

async function handleUpdate(change: ApplyPatchChange): Promise<AppliedChange> {
	if (!change.oldText) {
		throw new Error(`update requires oldText`);
	}
	if (change.oldText === change.newText) {
		throw new Error(`oldText and newText are identical — no change`);
	}

	// Read current content
	let content: string;
	try {
		content = await fs.promises.readFile(change.path, "utf8");
	} catch (err) {
		const msg = err instanceof Error ? err.message : String(err);
		throw new Error(`cannot read ${change.path}: ${msg}`);
	}

	// Apply replacement using our cascading replacer
	const result = replace(content, change.oldText, change.newText ?? "");
	if (!result.changed) {
		throw new Error(`oldText not found in ${change.path}`);
	}
	const newContent = result.content;

	// Generate simple diff
	const diff = generateDiff(change.path, content, newContent);

	// Write atomically
	await atomicWriteFile(change.path, newContent);

	return {
		path: change.path,
		action: "update",
		diff,
		bytes: Buffer.byteLength(newContent, "utf8"),
		oldContent: content,
		newContent,
	};
}

async function handleDelete(change: ApplyPatchChange): Promise<AppliedChange> {
	// Verify file exists
	try {
		await fs.promises.access(change.path);
	} catch {
		throw new Error(`file not found: ${change.path}`);
	}

	const oldContent = await fs.promises.readFile(change.path, "utf8");
	await fs.promises.unlink(change.path);

	return {
		path: change.path,
		action: "delete",
		oldContent,
	};
}

async function handleMove(change: ApplyPatchChange): Promise<AppliedChange> {
	if (!change.movePath) {
		throw new Error(`move requires movePath`);
	}

	// Verify source exists
	try {
		await fs.promises.access(change.path);
	} catch {
		throw new Error(`source file not found: ${change.path}`);
	}

	// Create parent directories for destination
	const dir = path.dirname(change.movePath);
	await fs.promises.mkdir(dir, { recursive: true });

	// Move file
	await fs.promises.rename(change.path, change.movePath);

	return { path: change.path, action: "move", movePath: change.movePath };
}

// ---------------------------------------------------------------------------
// Diff generation (simple, for UI feedback)
// ---------------------------------------------------------------------------

function generateDiff(_filePath: string, oldContent: string, newContent: string): string | undefined {
	if (oldContent === newContent) return undefined;

	const oldLines = oldContent.split("\n");
	const newLines = newContent.split("\n");
	const maxLen = Math.max(oldLines.length, newLines.length);

	let diff = "";
	let hasChanges = false;

	for (let i = 0; i < maxLen; i++) {
		const oldLine = oldLines[i] ?? "";
		const newLine = newLines[i] ?? "";

		if (oldLine !== newLine) {
			if (oldLine) diff += `- ${oldLine}\n`;
			if (newLine) diff += `+ ${newLine}\n`;
			hasChanges = true;
		} else if (oldLine) {
			diff += `  ${oldLine}\n`;
		}
	}

	return hasChanges ? diff : undefined;
}

// ---------------------------------------------------------------------------
// Main executor
// ---------------------------------------------------------------------------

export async function executeApplyPatch(changes: ApplyPatchChange[]): Promise<ApplyPatchResult> {
	const applied: AppliedChange[] = [];
	const errors: ApplyPatchError[] = [];

	for (const change of changes) {
		try {
			let result: AppliedChange;

			switch (change.action) {
				case "add":
					result = await handleAdd(change);
					break;
				case "update":
					result = await handleUpdate(change);
					break;
				case "delete":
					result = await handleDelete(change);
					break;
				case "move":
					result = await handleMove(change);
					break;
				default:
					throw new Error(`unknown action: ${(change as any).action}`);
			}

			applied.push(result);
		} catch (err) {
			const msg = err instanceof Error ? err.message : String(err);
			errors.push({
				path: change.path,
				action: change.action,
				error: msg,
			});
		}
	}

	return {
		ok: errors.length === 0,
		applied,
		errors,
	};
}

// ---------------------------------------------------------------------------
// Format result for tool output
// ---------------------------------------------------------------------------

export function formatApplyPatchResult(result: ApplyPatchResult): string {
	const lines: string[] = [];

	if (result.applied.length > 0) {
		lines.push(`Applied ${result.applied.length} change(s):`);
		for (const change of result.applied) {
			const rel = change.path;
			switch (change.action) {
				case "add":
					lines.push(`  A ${rel}`);
					break;
				case "update":
					lines.push(`  M ${rel}`);
					break;
				case "delete":
					lines.push(`  D ${rel}`);
					break;
				case "move":
					lines.push(`  M ${rel} -> ${change.movePath}`);
					break;
			}
		}
	}

	if (result.errors.length > 0) {
		lines.push(`\nFailed ${result.errors.length} change(s):`);
		for (const err of result.errors) {
			lines.push(`  [${err.action}] ${err.path}: ${err.error}`);
		}
	}

	return lines.join("\n");
}
