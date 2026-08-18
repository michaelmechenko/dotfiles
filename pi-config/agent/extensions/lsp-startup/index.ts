import { constants } from "node:fs";
import { access } from "node:fs/promises";
import { delimiter } from "node:path";
import { readFile } from "node:fs/promises";
import { join, isAbsolute } from "node:path";
import { CONFIG_DIR_NAME, type ExtensionAPI } from "@earendil-works/pi-coding-agent";

type ServerConfig = { disabled?: boolean; command?: string[] };
type LspConfig = false | { lsp?: false | Record<string, ServerConfig> };

async function readConfig(path: string): Promise<LspConfig | undefined> {
	try { return JSON.parse(await readFile(path, "utf8")) as LspConfig; } catch { return undefined; }
}
function serverConfigs(config: LspConfig | undefined): false | Record<string, ServerConfig> {
	if (config?.lsp === false) return false;
	return config?.lsp ?? {};
}
async function packageUsesLegacyConfigRoot(agentDir: string): Promise<boolean> {
	try {
		const source = await readFile(join(agentDir, "npm", "node_modules", "@dreki-gg", "pi-lsp", "extensions", "lsp", "config.ts"), "utf8");
		return source.includes("join(home, '.pi', 'agent'");
	} catch { return false; }
}
async function executableOnPath(command: string): Promise<boolean> {
	const candidates = isAbsolute(command) ? [command] : (process.env.PATH ?? "").split(delimiter).map((dir) => join(dir, command));
	for (const candidate of candidates) try { await access(candidate, constants.X_OK); return true; } catch { /* continue */ }
	return false;
}
async function commandResolution(command: string | undefined): Promise<"path" | "npx-unverified" | false> {
	if (!command) return false;
	if (await executableOnPath(command)) return "path";
	// pi-lsp may invoke `npx --yes <command> --version`, which can use the network
	// or install a package. Startup reporting does not repeat that costly probe.
	return !isAbsolute(command) && await executableOnPath("npx") ? "npx-unverified" : false;
}

export default function lspStartup(pi: ExtensionAPI) {
	pi.on("session_start", async (event, ctx) => {
		if (event.reason !== "startup" || ctx.mode !== "tui") return;
		const home = process.env.HOME ?? "";
		const agentDir = process.env.PI_CODING_AGENT_DIR ?? join(home, ".pi", "agent");
		const legacyRoot = await packageUsesLegacyConfigRoot(agentDir);
		const globalPath = legacyRoot ? join(home, ".pi", "agent", "extensions", "lsp", "config.json") : join(agentDir, "extensions", "lsp", "config.json");
		const [globalConfig, projectConfig] = await Promise.all([
			readConfig(globalPath),
			readConfig(join(ctx.cwd, CONFIG_DIR_NAME, "lsp.json")),
		]);
		const globalServers = serverConfigs(globalConfig);
		const projectServers = serverConfigs(projectConfig);
		if (globalServers === false || projectServers === false) return ctx.ui.notify("LSP disabled by configuration", "info");
		const effective = [...new Set([...Object.keys(globalServers), ...Object.keys(projectServers)])]
			.map((name) => [name, { ...globalServers[name], ...projectServers[name] }] as const)
			.filter(([, config]) => config.disabled !== true);
		const available: string[] = [], viaNpx: string[] = [], unavailable: string[] = [];
		for (const [name, config] of effective) {
			const resolution = await commandResolution(config.command?.[0]);
			(resolution === "path" ? available : resolution === "npx-unverified" ? viaNpx : unavailable).push(name);
		}
		const parts = [`LSP configured: ${effective.length ? effective.map(([name]) => name).join(", ") : "none"}`, `directly available: ${available.length ? available.join(", ") : "none"}`];
		if (viaNpx.length) parts.push(`direct executable missing; npx fallback unverified: ${viaNpx.join(", ")}`);
		if (unavailable.length) parts.push(`missing executable: ${unavailable.join(", ")}`);
		if (legacyRoot && agentDir !== join(home, ".pi", "agent")) parts.push("pi-lsp uses legacy ~/.pi config; PI_CODING_AGENT_DIR config is not active");
		ctx.ui.notify(parts.join("; "), unavailable.length || viaNpx.length || legacyRoot ? "warning" : "info");
	});
}
