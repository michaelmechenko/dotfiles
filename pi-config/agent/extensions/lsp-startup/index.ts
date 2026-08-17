import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { CONFIG_DIR_NAME, type ExtensionAPI } from "@earendil-works/pi-coding-agent";

type ServerConfig = { disabled?: boolean };
type LspConfig = false | { lsp?: false | Record<string, ServerConfig> };

async function readConfig(path: string): Promise<LspConfig | undefined> {
	try {
		return JSON.parse(await readFile(path, "utf8")) as LspConfig;
	} catch {
		return undefined;
	}
}

function serverConfigs(config: LspConfig | undefined): false | Record<string, ServerConfig> {
	if (!config || config.lsp === false) return false;
	return config.lsp ?? {};
}

export default function lspStartup(pi: ExtensionAPI) {
	pi.on("session_start", async (event, ctx) => {
		if (event.reason !== "startup" || ctx.mode !== "tui") return;

		const agentDir = process.env.PI_CODING_AGENT_DIR ?? join(process.env.HOME ?? "", ".pi", "agent");
		const [globalConfig, projectConfig] = await Promise.all([
			readConfig(join(agentDir, "extensions", "lsp", "config.json")),
			readConfig(join(ctx.cwd, CONFIG_DIR_NAME, "lsp.json")),
		]);
		const globalServers = serverConfigs(globalConfig);
		const projectServers = serverConfigs(projectConfig);
		if (globalServers === false || projectServers === false) return;

		const names = new Set([...Object.keys(globalServers), ...Object.keys(projectServers)]);
		const enabled = [...names].filter((name) => ({ ...globalServers[name], ...projectServers[name] }).disabled !== true);
		ctx.ui.notify(`LSP enabled: ${enabled.length > 0 ? enabled.join(", ") : "none"}`, "info");
	});
}
