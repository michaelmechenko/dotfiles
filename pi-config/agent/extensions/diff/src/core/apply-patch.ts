/**
 * apply_patch — Multi-file patch engine.
 *
 * One call can add, update, delete, or move multiple files.
 * Uses replace.ts cascading replacer for oldText → newText matching.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { replaceForPatch } from "./replace.js";

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

async function atomicWriteFile(filePath: string, content: string, mode?: number): Promise<void> {
	const dir = path.dirname(filePath);
	const tmp = path.join(dir, `.${path.basename(filePath)}.pi-apply-patch.${process.pid}.tmp`);
	await fs.promises.writeFile(tmp, content, { encoding: "utf8", mode });
	await fs.promises.rename(tmp, filePath);
}

interface PreparedChange {
	change: ApplyPatchChange;
	applied: AppliedChange;
	commit(): Promise<void>;
	rollback(): Promise<void>;
}

interface FileSnapshot {
	content: string;
	mode: number;
}

async function readRegularFile(filePath: string, label: string): Promise<FileSnapshot> {
	let stats: fs.Stats;
	try {
		stats = await fs.promises.lstat(filePath);
	} catch {
		throw new Error(`${label} not found: ${filePath}`);
	}
	if (stats.isSymbolicLink()) throw new Error(`${label} must not be a symbolic link: ${filePath}`);
	if (!stats.isFile()) throw new Error(`${label} must be a regular file: ${filePath}`);
	return { content: await fs.promises.readFile(filePath, "utf8"), mode: stats.mode };
}

async function pathExists(filePath: string): Promise<boolean> {
	try {
		await fs.promises.lstat(filePath);
		return true;
	} catch {
		return false;
	}
}

async function prepareAdd(change: ApplyPatchChange): Promise<PreparedChange> {
	if (await pathExists(change.path)) throw new Error(`add target already exists: ${change.path}`);
	const content = change.content ?? "";
	const final = content.endsWith("\n") ? content : `${content}\n`;

	return {
		change,
		applied: { path: change.path, action: "add", bytes: Buffer.byteLength(final, "utf8"), newContent: final },
		async commit() {
			await fs.promises.mkdir(path.dirname(change.path), { recursive: true });
			await atomicWriteFile(change.path, final);
		},
		async rollback() {
			await fs.promises.unlink(change.path);
		},
	};
}

async function prepareUpdate(change: ApplyPatchChange): Promise<PreparedChange> {
	if (!change.oldText) throw new Error("update requires oldText");
	if (change.oldText === change.newText) throw new Error("oldText and newText are identical — no change");

	const original = await readRegularFile(change.path, "update target");
	const result = replaceForPatch(original.content, change.oldText, change.newText ?? "");
	if (!result.changed) throw new Error(`oldText not found in ${change.path}`);

	const newContent = result.content;
	return {
		change,
		applied: {
			path: change.path,
			action: "update",
			diff: generateDiff(change.path, original.content, newContent),
			bytes: Buffer.byteLength(newContent, "utf8"),
			oldContent: original.content,
			newContent,
		},
		async commit() {
			await atomicWriteFile(change.path, newContent, original.mode);
		},
		async rollback() {
			await atomicWriteFile(change.path, original.content, original.mode);
		},
	};
}

async function prepareDelete(change: ApplyPatchChange): Promise<PreparedChange> {
	const original = await readRegularFile(change.path, "delete target");
	return {
		change,
		applied: { path: change.path, action: "delete", oldContent: original.content },
		async commit() {
			await fs.promises.unlink(change.path);
		},
		async rollback() {
			await atomicWriteFile(change.path, original.content, original.mode);
		},
	};
}

async function prepareMove(change: ApplyPatchChange): Promise<PreparedChange> {
	const movePath = change.movePath;
	if (!movePath) throw new Error("move requires movePath");
	await readRegularFile(change.path, "move source");
	if (await pathExists(movePath)) throw new Error(`move destination already exists: ${movePath}`);

	return {
		change,
		applied: { path: change.path, action: "move", movePath },
		async commit() {
			await fs.promises.mkdir(path.dirname(movePath), { recursive: true });
			await fs.promises.rename(change.path, movePath);
		},
		async rollback() {
			await fs.promises.rename(movePath, change.path);
		},
	};
}

async function prepareChange(change: ApplyPatchChange): Promise<PreparedChange> {
	switch (change.action) {
		case "add":
			return prepareAdd(change);
		case "update":
			return prepareUpdate(change);
		case "delete":
			return prepareDelete(change);
		case "move":
			return prepareMove(change);
		default:
			throw new Error(`unknown action: ${(change as { action: string }).action}`);
	}
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
	const prepared: PreparedChange[] = [];
	const errors: ApplyPatchError[] = [];
	const claimedPaths = new Set<string>();

	for (const change of changes) {
		const paths = [change.path, ...(change.action === "move" && change.movePath ? [change.movePath] : [])].map(
			(filePath) => path.resolve(filePath),
		);
		if (paths.some((filePath) => claimedPaths.has(filePath))) {
			errors.push({
				path: change.path,
				action: change.action,
				error: "each source and destination path may appear only once per patch",
			});
			continue;
		}
		for (const filePath of paths) claimedPaths.add(filePath);

		try {
			prepared.push(await prepareChange(change));
		} catch (err) {
			errors.push({
				path: change.path,
				action: change.action,
				error: err instanceof Error ? err.message : String(err),
			});
		}
	}

	if (errors.length > 0) return { ok: false, applied: [], errors };

	const committed: PreparedChange[] = [];
	try {
		for (const change of prepared) {
			await change.commit();
			committed.push(change);
		}
	} catch (err) {
		for (const change of committed.reverse()) {
			try {
				await change.rollback();
			} catch (rollbackError) {
				errors.push({
					path: change.change.path,
					action: change.change.action,
					error: `rollback failed: ${rollbackError instanceof Error ? rollbackError.message : String(rollbackError)}`,
				});
			}
		}
		errors.unshift({
			path: prepared[committed.length]?.change.path ?? "",
			action: prepared[committed.length]?.change.action ?? "commit",
			error: err instanceof Error ? err.message : String(err),
		});
		return { ok: false, applied: [], errors };
	}

	return { ok: true, applied: prepared.map((change) => change.applied), errors: [] };
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
