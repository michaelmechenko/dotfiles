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

export interface AgentDiscoveryResult {
	agents: AgentConfig[];
	projectAgentsDir: string | null;
	diagnostics: string[];
}
type AgentFrontmatter = { name?: unknown; description?: unknown; tools?: unknown; model?: unknown };
const MAX_DIAGNOSTICS = 32;
const MAX_DIAGNOSTIC_BYTES = 1024;
const MAX_AGENT_NAME_BYTES = 128;
const MAX_DESCRIPTION_BYTES = 2 * 1024;
const MAX_MODEL_BYTES = 1024;

function truncateUtf8(value: string, cap: number): string {
	if (Buffer.byteLength(value, "utf8") <= cap) return value;
	let clipped = value.slice(0, cap);
	while (Buffer.byteLength(clipped, "utf8") > cap) clipped = clipped.slice(0, -1);
	return clipped;
}

function addDiagnostic(diagnostics: string[], value: string): void {
	if (diagnostics.length < MAX_DIAGNOSTICS) diagnostics.push(truncateUtf8(value, MAX_DIAGNOSTIC_BYTES));
}

function loadAgentsFromDir(dir: string, source: AgentConfig["source"], diagnostics: string[]): AgentConfig[] {
	let entries: fs.Dirent[];
	try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return []; }
	const agents: AgentConfig[] = [];
	for (const entry of entries) {
		if (!entry.name.endsWith(".md") || (!entry.isFile() && !entry.isSymbolicLink())) continue;
		const filePath = path.join(dir, entry.name);
		try {
			const { frontmatter, body } = parseFrontmatter<AgentFrontmatter>(fs.readFileSync(filePath, "utf8"));
			if (typeof frontmatter.name !== "string" || !frontmatter.name.trim() || typeof frontmatter.description !== "string" || !frontmatter.description.trim()) {
				addDiagnostic(diagnostics, `${filePath}: missing required name or description frontmatter`);
				continue;
			}
			const parsedTools = parseToolList(frontmatter.tools);
			if (parsedTools.status === "invalid") {
				addDiagnostic(diagnostics, `${filePath}: ${parsedTools.error}`);
				continue;
			}
			agents.push({
				name: truncateUtf8(frontmatter.name.trim(), MAX_AGENT_NAME_BYTES),
				description: truncateUtf8(frontmatter.description.trim(), MAX_DESCRIPTION_BYTES),
				tools: parsedTools.status === "valid" ? parsedTools.tools : undefined,
				model: typeof frontmatter.model === "string" && frontmatter.model.trim() ? truncateUtf8(frontmatter.model.trim(), MAX_MODEL_BYTES) : undefined,
				systemPrompt: body,
				source,
				filePath,
			});
		} catch (error) {
			addDiagnostic(diagnostics, `${filePath}: ${error instanceof Error ? error.message : String(error)}`);
		}
	}
	return agents;
}

function findNearestProjectAgentsDir(cwd: string): string | null {
	for (let current = path.resolve(cwd); ; current = path.dirname(current)) {
		const candidate = path.join(current, CONFIG_DIR_NAME, "agents");
		try { if (fs.statSync(candidate).isDirectory()) return candidate; } catch { /* continue */ }
		if (path.dirname(current) === current) return null;
	}
}

export function discoverAgents(cwd: string, scope: AgentScope): AgentDiscoveryResult {
	const diagnostics: string[] = [];
	const projectAgentsDir = findNearestProjectAgentsDir(cwd);
	const user = scope === "project" ? [] : loadAgentsFromDir(path.join(getAgentDir(), "agents"), "user", diagnostics);
	const project = scope === "user" || !projectAgentsDir ? [] : loadAgentsFromDir(projectAgentsDir, "project", diagnostics);
	const agents = new Map<string, AgentConfig>();
	for (const agent of user) agents.set(agent.name, agent);
	for (const agent of project) agents.set(agent.name, agent);
	return { agents: [...agents.values()], projectAgentsDir, diagnostics };
}

export function formatAgentList(agents: AgentConfig[], maxItems: number): { text: string; remaining: number } {
	return { text: agents.slice(0, maxItems).map((agent) => `${agent.name} (${agent.source}): ${agent.description}`).join("; ") || "none", remaining: Math.max(0, agents.length - maxItems) };
}
