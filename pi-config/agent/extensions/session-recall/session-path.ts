import { existsSync, realpathSync } from "node:fs";
import { isAbsolute, relative, resolve, sep } from "node:path";

/** Resolve an existing session file and reject symlink or traversal escapes. */
export function canonicalSessionPath(input: unknown, sessionsRoot: string): string | undefined {
	if (typeof input !== "string") return undefined;
	const path = input.replace(/^@+/, "").trim();
	if (!path.endsWith(".jsonl") || !existsSync(path)) return undefined;
	try {
		const root = realpathSync.native(sessionsRoot);
		const file = realpathSync.native(resolve(path));
		const rel = relative(root, file);
		return rel && rel !== ".." && !rel.startsWith(`..${sep}`) && !isAbsolute(rel) ? file : undefined;
	} catch {
		return undefined;
	}
}
