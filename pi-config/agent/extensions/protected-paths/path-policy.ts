import { existsSync, realpathSync } from "node:fs";
import { basename, dirname, isAbsolute, join, normalize, resolve, sep } from "node:path";

const PROTECTED_DIRECTORIES = new Set([".git", "node_modules", ".ssh"]);

/** Resolve user syntax and existing symlink ancestors without requiring a target to exist. */
export function canonicalPath(input: unknown, cwd: string): string | undefined {
	if (typeof input !== "string") return undefined;
	const trimmed = input.replace(/^@+/, "").trim();
	if (!trimmed) return undefined;
	const absolute = normalize(isAbsolute(trimmed) ? trimmed : resolve(cwd, trimmed));
	let ancestor = absolute;
	const remainder: string[] = [];
	while (!existsSync(ancestor)) {
		const parent = dirname(ancestor);
		if (parent === ancestor) return absolute;
		remainder.unshift(basename(ancestor));
		ancestor = parent;
	}
	try {
		return resolve(realpathSync.native(ancestor), ...remainder);
	} catch {
		return absolute;
	}
}

export function isProtectedPath(input: unknown, cwd: string): boolean {
	const path = canonicalPath(input, cwd);
	if (!path) return false;
	const parts = path.split(sep).filter(Boolean);
	if (parts.some((part) => PROTECTED_DIRECTORIES.has(part))) return true;
	const name = basename(path);
	return name === ".env" || name.startsWith(".env.") || name === "auth.json" || name === "id_rsa" || name.endsWith(".pem");
}

/** All filesystem locations a mutable Pi tool can affect. */
export function mutationPaths(toolName: string, input: unknown): unknown[] {
	if (!input || typeof input !== "object") return [];
	const value = input as { path?: unknown; changes?: unknown };
	if (toolName === "write" || toolName === "edit") return [value.path];
	if (toolName !== "apply_patch" || !Array.isArray(value.changes)) return [];
	return value.changes.flatMap((change) => {
		if (!change || typeof change !== "object") return [];
		const item = change as { path?: unknown; movePath?: unknown };
		return [item.path, item.movePath];
	});
}
