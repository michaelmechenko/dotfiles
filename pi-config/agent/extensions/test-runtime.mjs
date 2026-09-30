import { execFileSync } from "node:child_process";
import { existsSync, realpathSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const executable = realpathSync(execFileSync("which", ["pi"], { encoding: "utf8" }).trim());
export const root = [process.env.PI_PACKAGE_DIR, resolve(dirname(executable), "..", ".."), resolve(dirname(executable), "../lib/node_modules/pi-monorepo")]
	.filter(Boolean).find((candidate) => existsSync(resolve(candidate, "dist/index.js")));
if (!root) throw new Error("Set PI_PACKAGE_DIR to the installed Pi package root");
const require = createRequire(resolve(root, "dist/index.js"));
const { createJiti } = await import(pathToFileURL(resolve(root, "node_modules/jiti/lib/jiti.mjs")).href);
export const jiti = createJiti(import.meta.url, { fsCache: false, moduleCache: false, alias: {
	"@earendil-works/pi-coding-agent": resolve(root, "dist/index.js"),
	"@earendil-works/pi-ai": resolve(root, "node_modules/@earendil-works/pi-ai/dist/compat.js"),
	"@earendil-works/pi-agent-core": resolve(root, "node_modules/@earendil-works/pi-agent-core/dist/index.js"),
	"@earendil-works/pi-tui": require.resolve("@earendil-works/pi-tui"),
	typebox: require.resolve("typebox"),
} });
