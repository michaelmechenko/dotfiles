import { execFileSync } from "node:child_process";
import { existsSync, realpathSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { homedir } from "node:os";
import { pathToFileURL } from "node:url";

const piCli = realpathSync(execFileSync("which", ["pi"], { encoding: "utf8" }).trim());
const candidates = [
	process.env.PI_PACKAGE_DIR,
	resolve(dirname(piCli), "..", ".."), // npm dist/cli.js
	resolve(dirname(piCli), "../lib/node_modules/pi-monorepo"), // Nix wrapper
].filter(Boolean);
export const codingAgentRoot = candidates.find((root) => existsSync(resolve(root, "dist/index.js")));
if (!codingAgentRoot) throw new Error("Cannot locate Pi; set PI_PACKAGE_DIR to its package root");
export const codingAgentPath = resolve(codingAgentRoot, "dist/index.js");
export const tuiPath = resolve(codingAgentRoot, "node_modules/@earendil-works/pi-tui/dist/index.js");
export const agent = await import(pathToFileURL(codingAgentPath).href);
export const themeModule = await import(pathToFileURL(resolve(codingAgentRoot, "dist/modes/interactive/theme/theme.js")).href);
export const tui = await import(pathToFileURL(tuiPath).href);
const { createJiti } = await import(pathToFileURL(resolve(codingAgentRoot, "node_modules/jiti/lib/jiti.mjs")).href);
const alias = { "@earendil-works/pi-coding-agent": codingAgentPath, "@earendil-works/pi-tui": tuiPath };
// Test checkout sources against already-installed runtime dependencies on NixOS.
const deployedPretty = resolve(process.env.PI_CODING_AGENT_DIR ?? resolve(homedir(), ".config/pi-config/agent"), "extensions/pretty/package.json");
if (existsSync(deployedPretty)) {
	const require = createRequire(realpathSync(deployedPretty));
	for (const name of ["shiki", "@shikijs/cli"]) alias[name] = require.resolve(name);
}
export const jiti = createJiti(import.meta.url, { fsCache: false, moduleCache: false, alias });
