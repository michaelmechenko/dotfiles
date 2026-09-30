import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";
import { jiti } from "../test-runtime.mjs";

const dir = mkdtempSync(join(tmpdir(), "pi-subagent-integration-"));
const previousAgentDir = process.env.PI_CODING_AGENT_DIR;
process.env.PI_CODING_AGENT_DIR = dir;
const { default: register } = await jiti.import(resolve(import.meta.dirname, "index.ts"));
const { discoverAgents } = await jiti.import(resolve(import.meta.dirname, "agents.ts"));
const project = join(dir, "project");
mkdirSync(join(project, ".pi", "agents"), { recursive: true });
writeFileSync(join(project, ".pi", "agents", "local.md"), "---\nname: local\ndescription: local agent\ntools: [read]\n---\nRead only.");

function harness(mode = "none") {
	const handlers = new Map<string, any>();
	let tool: any;
	const pi: any = {
		on: (event: string, callback: any) => handlers.set(event, callback),
		registerTool: (value: any) => { tool = value; },
		getActiveTools: () => ["read", "bash", "lsp_navigation"],
		events: { emit: (_: string, callback: (mode: string) => void) => callback(mode) },
	};
	register(pi);
	const context: any = { cwd: project, model: undefined, thinkingLevel: "off", hasUI: false, ui: { confirm: async () => true } };
	return { handlers, get tool() { return tool; }, context };
}

test("model cannot bypass interactive project agent approval", async () => {
	const { tool, context } = harness();
	assert.equal("confirmProjectAgents" in tool.parameters.properties, false);
	await assert.rejects(tool.execute("1", { agent: "local", task: "Read", agentScope: "project", confirmProjectAgents: false }, undefined, undefined, context), /interactive approval/);
});

test("project-agent discovery rejects symlinks and oversized files before loading prompts", () => {
	const agents = join(project, ".pi", "agents");
	const outside = join(dir, "outside.md");
	writeFileSync(outside, "---\nname: outside\ndescription: foreign\n---\nForeign.");
	symlinkSync(outside, join(agents, "link.md"));
	writeFileSync(join(agents, "large.md"), "x".repeat(128 * 1024 + 1));
	const result = discoverAgents(project, "project");
	assert.deepEqual(result.agents.map((agent: { name: string }) => agent.name), ["local"]);
	assert.ok(result.diagnostics.some((message: string) => message.includes("symlinks")));
	assert.ok(result.diagnostics.some((message: string) => message.includes("exceeds")));
	const linkedProject = join(dir, "linked-project");
	mkdirSync(linkedProject);
	symlinkSync(join(project, ".pi"), join(linkedProject, ".pi"));
	assert.deepEqual(discoverAgents(linkedProject, "project").agents, []);
});

test("child registered tool hook enforces the parent tool ceiling and parameter restrictions", () => {
	process.env.PI_SUBAGENT_ACCESS_MODE = "read-only";
	process.env.PI_SUBAGENT_ALLOWED_TOOLS = JSON.stringify(["read", "lsp_navigation"]);
	try {
		const { handlers } = harness();
		const event = { systemPromptOptions: { selectedTools: ["read", "bash", "lsp_navigation", "write"] } };
		handlers.get("before_agent_start")(event);
		assert.deepEqual(event.systemPromptOptions.selectedTools, ["read", "lsp_navigation"]);
		assert.equal(handlers.get("tool_call")({ toolName: "bash", input: { command: "echo hi" } }).block, true);
		const blocked = handlers.get("tool_call")({ toolName: "lsp_navigation", input: { operation: "rename", apply: true } });
		assert.equal(blocked.block, true);
		assert.equal(handlers.get("tool_call")({ toolName: "lsp_navigation", input: { operation: "rename", apply: false } }), undefined);
	} finally { delete process.env.PI_SUBAGENT_ACCESS_MODE; delete process.env.PI_SUBAGENT_ALLOWED_TOOLS; }
});

process.on("exit", () => {
	if (previousAgentDir === undefined) delete process.env.PI_CODING_AGENT_DIR;
	else process.env.PI_CODING_AGENT_DIR = previousAgentDir;
	rmSync(dir, { recursive: true, force: true });
});
