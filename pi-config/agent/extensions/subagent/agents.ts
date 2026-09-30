/** Agent discovery and configuration. */

import * as fs from "node:fs";
import * as path from "node:path";
import { CONFIG_DIR_NAME, getAgentDir, parseFrontmatter } from "@earendil-works/pi-coding-agent";
import { parseToolList } from "./frontmatter.ts";
import { truncateUtf8 } from "./utf8.ts";

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
const MAX_PROJECT_AGENT_FILES = 64;
const MAX_AGENT_FILE_BYTES = 128 * 1024;

function addDiagnostic(diagnostics: string[], value: string): void {
	if (diagnostics.length < MAX_DIAGNOSTICS) diagnostics.push(truncateUtf8(value, MAX_DIAGNOSTIC_BYTES));
}

function loadAgentsFromDir(dir: string, source: AgentConfig["source"], diagnostics: string[]): AgentConfig[] {
	let entries: fs.Dirent[];
	try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return []; }
	const agents: AgentConfig[] = [];
	let projectFiles = 0;
	for (const entry of entries) {
		if (!entry.name.endsWith(".md") || (!entry.isFile() && !entry.isSymbolicLink())) continue;
		const filePath = path.join(dir, entry.name);
		if (source === "project" && ++projectFiles > MAX_PROJECT_AGENT_FILES) { addDiagnostic(diagnostics, `${dir}: project agent file limit exceeded`); break; }
		if (source === "project" && entry.isSymbolicLink()) { addDiagnostic(diagnostics, `${filePath}: project agent symlinks are not supported`); continue; }
		try {
			// Validate the opened descriptor, not a path that can be swapped after stat.
			const descriptor = fs.openSync(filePath, fs.constants.O_RDONLY | fs.constants.O_NONBLOCK | (source === "project" ? fs.constants.O_NOFOLLOW : 0));
			let content: string;
			try {
				const stat = fs.fstatSync(descriptor);
				if (!stat.isFile() || stat.size > MAX_AGENT_FILE_BYTES) { addDiagnostic(diagnostics, `${filePath}: agent file exceeds ${MAX_AGENT_FILE_BYTES} bytes or is not regular`); continue; }
				const bytes = Buffer.alloc(MAX_AGENT_FILE_BYTES + 1);
				let used = 0;
				while (used < bytes.length) {
					const count = fs.readSync(descriptor, bytes, used, bytes.length - used, null);
					if (!count) break;
					used += count;
				}
				if (used > MAX_AGENT_FILE_BYTES) { addDiagnostic(diagnostics, `${filePath}: agent file exceeds ${MAX_AGENT_FILE_BYTES} bytes`); continue; }
				content = bytes.toString("utf8", 0, used);
			} finally { fs.closeSync(descriptor); }
			const { frontmatter, body } = parseFrontmatter<AgentFrontmatter>(content);
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
		const config = path.join(current, CONFIG_DIR_NAME);
		const candidate = path.join(config, "agents");
		try { if (!fs.lstatSync(config).isSymbolicLink() && !fs.lstatSync(candidate).isSymbolicLink() && fs.statSync(candidate).isDirectory()) return candidate; } catch { /* continue */ }
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

export function requireProjectApproval(hasUI: boolean): void {
	if (!hasUI) throw new Error("Project-local agents require interactive approval.");
}

export function formatAgentList(agents: AgentConfig[], maxItems: number): { text: string; remaining: number } {
	return { text: agents.slice(0, maxItems).map((agent) => `${agent.name} (${agent.source}): ${agent.description}`).join("; ") || "none", remaining: Math.max(0, agents.length - maxItems) };
}
