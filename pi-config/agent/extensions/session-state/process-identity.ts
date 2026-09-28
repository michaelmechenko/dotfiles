import { execFileSync } from "node:child_process";

/** Locale-stable OS process-instance token, shared by live tmux registries. */
export function processStartToken(pid = process.pid): string {
	try {
		return execFileSync("ps", ["-o", "lstart=", "-p", String(pid)], {
			encoding: "utf8",
			env: { ...process.env, LC_ALL: "C" },
		}).trim().replace(/\s+/g, " ");
	} catch {
		return "";
	}
}
