#!/usr/bin/env node
/** Isolated, credential-free package/MCP smoke check against the installed Pi runtime.
 * Usage: PI_TEST_BROWSER_EXECUTABLE=/path/to/browser node pi-config/runtime-check.mjs /path/to/built/pi/npm/workspace
 */
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, rm, access, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve, join } from "node:path";
import { pathToFileURL } from "node:url";
import { jiti, root } from "./agent/extensions/test-runtime.mjs";

const workspace = resolve(process.argv[2] ?? "");
assert.ok(process.argv[2], "Pass a built npm workspace; this check never installs packages");
const browser = process.env.PI_TEST_BROWSER_EXECUTABLE;
assert.ok(browser, "Set PI_TEST_BROWSER_EXECUTABLE to a Chromium-compatible browser");
const intercom = join(workspace, "node_modules/pi-intercom");
await access(join(intercom, "index.ts"));
assert.equal(JSON.parse(await readFile(join(intercom, "package.json"), "utf8")).version, "0.16.0", "Intercom runtime version drifted");
const directory = await mkdtemp(join(tmpdir(), "pi-runtime-check-"));
process.env.PI_CODING_AGENT_DIR = directory;
delete process.env.PI_INTERCOM_STABLE_ID;
delete process.env.PI_INTERCOM_SCOPE_ID;
delete process.env.TMUX_PANE;
delete process.env.HERDR_PANE_ID;
const sdk = await import(pathToFileURL(join(root, "dist/index.js")).href);
const ai = await jiti.import("@earendil-works/pi-ai");
const { AuthStorage } = await import(pathToFileURL(join(root, "dist/core/auth-storage.js")).href);
const { loadConfig } = await jiti.import(join(intercom, "config.ts"));
const config = loadConfig();
assert.equal(config.confirmSend, false);
assert.equal(config.inboundTrigger, "always");
assert.equal(config.busyDelivery, "steer");
const sessions = [];
const errors = [];
const waitUntil = async (predicate) => {
	for (let attempt = 0; attempt < 100; attempt++) {
		if (predicate()) return;
		await new Promise((done) => setTimeout(done, 100));
	}
	assert.fail("Timed out waiting for isolated Intercom delivery");
};
try {
	// A real native MCP connection, but an isolated browser context and no user credentials.
	await writeFile(join(directory, "mcp.json"), JSON.stringify({ mcpServers: {
		browser: { command: "npx", args: ["-y", "chrome-devtools-mcp@1.10.1", `--executable-path=${browser}`, "--isolated", "--no-usage-statistics", "--no-performance-crux", "--redact-network-headers"], exposure: "deferred", toolExposure: { list_pages: "direct" } },
	} }), { mode: 0o600 });
	for (const name of ["sender", "receiver"]) {
		const cwd = join(directory, name);
		await mkdir(cwd);
		const settingsManager = sdk.SettingsManager.inMemory({ packages: [{ source: intercom }], defaultTools: ["+codemode", "+tool_search"], compaction: { enabled: false } });
		const modelRuntime = await sdk.ModelRuntime.create({ credentials: AuthStorage.inMemory(), modelsPath: null, refreshOnCreate: false });
		const model = modelRuntime.getModels("anthropic")[0];
		assert.ok(model);
		await modelRuntime.setRuntimeApiKey("anthropic", "isolated-test-not-a-real-key");
		const resourceLoader = new sdk.DefaultResourceLoader({ cwd, agentDir: directory, settingsManager,
			noContextFiles: true, noThemes: true, noPromptTemplates: true,
			extensionFactories: name === "sender" ? [sdk.createMcpExtension(), sdk.createCodemodeExtension({ mode: "on" }), sdk.createToolSearchExtension()] : [],
		});
		await resourceLoader.reload();
		assert.deepEqual(resourceLoader.getExtensions().errors, []);
		assert.ok(resourceLoader.getSkills().skills.some((skill) => skill.name === "pi-intercom"));
		const manager = sdk.SessionManager.inMemory(cwd);
		manager.appendSessionInfo(name);
		const { session } = await sdk.createAgentSession({ cwd, agentDir: directory, settingsManager, resourceLoader, modelRuntime, model, sessionManager: manager });
		sessions.push(session);
		session.extensionRunner.onError((error) => errors.push(error));
		// Incoming defaults may trigger a turn. Replace the model transport so no network/model cost is possible.
		session.agent.streamFunction = () => {
			const stream = ai.createAssistantMessageEventStream();
			const message = { role: "assistant", content: [{ type: "text", text: "isolated fixture response" }], api: model.api, provider: model.provider, model: model.id,
				usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } }, stopReason: "stop", timestamp: Date.now() };
			stream.push({ type: "done", reason: "stop", message });
			return stream;
		};
		await session.bindExtensions({});
		await session.prompt("Seed the isolated test conversation.");
	}
	const [sender, receiver] = sessions;
	const context = sender.extensionRunner.createToolContext("smoke", undefined);
	const call = (name, args) => context.executeTool(name, args);
	await receiver.extensionRunner.createToolContext("receiver-smoke", undefined).executeTool("intercom", { action: "status" });
	const roster = await call("intercom", { action: "list" });
	assert.ok(JSON.stringify(roster).includes("receiver"), JSON.stringify(roster));
	const previousAssistantCount = receiver.messages.filter((message) => message.role === "assistant").length;
	await call("intercom", { action: "send", to: "receiver", message: "isolated delivery fixture" });
	await waitUntil(() => receiver.messages.some((message) => message.customType === "intercom_message"));
	await waitUntil(() => receiver.messages.filter((message) => message.role === "assistant").length > previousAssistantCount);
	assert.ok(sender.getAllTools().some((tool) => tool.name === "intercom"));
	assert.ok(!sender.getAllTools().some((tool) => ["mcp", "mcpScript"].includes(tool.name)));
	// Orchestrators are model-only; invoke their registered definitions, not a nested orchestrator call.
	const search = await sender.extensionRunner.getToolDefinition("tool_search").execute("search-smoke", { query: "a11y tree snapshot" }, undefined, undefined, context);
	assert.ok(search.details.loaded.length > 0 && search.details.loaded.every((name) => name.startsWith("mcp__browser__")), JSON.stringify(search));
	const pages = await sender.extensionRunner.getToolDefinition("codemode").execute("code-smoke", { code: "const result = await tools.mcp__browser__list_pages({}); for (const block of result.content ?? []) if (block.type === 'text') text(block.text);" }, undefined, undefined, context);
	assert.ok(!pages.isError, JSON.stringify(pages));
	assert.ok(JSON.stringify(pages).includes("Page"));
	assert.deepEqual(errors, []);
	console.log("Pi runtime check passed: native MCP/search/codemode, bundled Intercom skill, two-session delivery, automatic inbound turn, no model network.");
} finally {
	for (const session of sessions) {
		await session.extensionRunner.emit({ type: "session_shutdown" });
		session.dispose();
	}
	// The upstream broker owns its idle shutdown; do not kill unrelated brokers.
	await new Promise((done) => setTimeout(done, 6000));
	await rm(directory, { recursive: true, force: true });
}
