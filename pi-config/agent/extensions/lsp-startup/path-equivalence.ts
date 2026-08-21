import { realpath } from "node:fs/promises";

/** True when two paths resolve to the same directory (or are string-equal when
 * neither resolves, e.g. both dangling). Used to detect whether pi's agent dir
 * and the legacy ~/.pi/agent spell the same real root through a symlink, so the
 * legacy-config-root warning only fires for genuinely distinct roots. */
export async function samePath(first: string, second: string): Promise<boolean> {
	try {
		return (await realpath(first)) === (await realpath(second));
	} catch {
		return first === second;
	}
}
