/** Agent discovery and configuration. */

import * as fs from "node:fs";
import * as path from "node:path";
import { CONFIG_DIR_NAME, getAgentDir, parseFrontmatter } from "@earendil-works/pi-coding-agent";
import { parseToolList } from "./frontmatter.ts";

export type AgentScope = "user" | "project" | "both";

export interface AgentConfig {
	name: string;
	description: string;
	tools?: string[];
	model?: string;
	systemPrompt: string;
	source: "user" | "project";
	filePath: string;
}

export interface AgentDiscoveryResult { agents: AgentConfig[]; projectAgentsDir: string | null }
type AgentFrontmatter = { name?: unknown; description?: unknown; tools?: unknown; model?: unknown };

function loadAgentsFromDir(dir: string, source: AgentConfig["source"]): AgentConfig[] {
	let entries: fs.Dirent[];
	try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return []; }
	const agents: AgentConfig[] = [];
	for (const entry of entries) {
		if (!entry.name.endsWith(".md") || (!entry.isFile() && !entry.isSymbolicLink())) continue;
		try {
			const filePath = path.join(dir, entry.name);
			const { frontmatter, body } = parseFrontmatter<AgentFrontmatter>(fs.readFileSync(filePath, "utf8"));
			if (typeof frontmatter.name !== "string" || typeof frontmatter.description !== "string") continue;
			agents.push({ name: frontmatter.name, description: frontmatter.description, tools: parseToolList(frontmatter.tools), model: typeof frontmatter.model === "string" ? frontmatter.model : undefined, systemPrompt: body, source, filePath });
		} catch { /* a malformed agent must not hide valid siblings */ }
	}
	return agents;
}

function findNearestProjectAgentsDir(cwd: string): string | null {
	for (let current = cwd; ; current = path.dirname(current)) {
		const candidate = path.join(current, CONFIG_DIR_NAME, "agents");
		try { if (fs.statSync(candidate).isDirectory()) return candidate; } catch { /* continue */ }
		if (path.dirname(current) === current) return null;
	}
}

export function discoverAgents(cwd: string, scope: AgentScope): AgentDiscoveryResult {
	const projectAgentsDir = findNearestProjectAgentsDir(cwd);
	const user = scope === "project" ? [] : loadAgentsFromDir(path.join(getAgentDir(), "agents"), "user");
	const project = scope === "user" || !projectAgentsDir ? [] : loadAgentsFromDir(projectAgentsDir, "project");
	const agents = new Map<string, AgentConfig>();
	for (const agent of user) agents.set(agent.name, agent);
	for (const agent of project) agents.set(agent.name, agent);
	return { agents: [...agents.values()], projectAgentsDir };
}

export function formatAgentList(agents: AgentConfig[], maxItems: number): { text: string; remaining: number } {
	return { text: agents.slice(0, maxItems).map((agent) => `${agent.name} (${agent.source}): ${agent.description}`).join("; ") || "none", remaining: Math.max(0, agents.length - maxItems) };
}
