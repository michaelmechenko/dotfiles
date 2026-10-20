import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";
import { root } from "../../test-runtime.mjs";

const sdk = await import(pathToFileURL(join(root, "dist/index.js")).href);
const { AuthStorage } = await import(pathToFileURL(join(root, "dist/core/auth-storage.js")).href);

for (const mode of ["on", "only"]) {
	test(`session-recall survives codemode ${mode} loadout changes`, async () => {
		const directory = await mkdtemp(join(tmpdir(), "pi-recall-codemode-"));
		let session;
		try {
			// No user settings, credentials, transcripts, MCP servers, or model calls.
			const settingsManager = sdk.SettingsManager.inMemory({ defaultTools: ["+codemode"] });
			const modelRuntime = await sdk.ModelRuntime.create({
				credentials: AuthStorage.inMemory(), modelsPath: null, refreshOnCreate: false,
			});
			const resourceLoader = new sdk.DefaultResourceLoader({
				cwd: directory, agentDir: directory, settingsManager,
				noContextFiles: true, noThemes: true, noSkills: true, noPromptTemplates: true,
				additionalExtensionPaths: [
					fileURLToPath(new URL("../index.ts", import.meta.url)),
					fileURLToPath(new URL("../../tool-toggle/index.ts", import.meta.url)),
				],
				extensionFactories: [sdk.createCodemodeExtension({ mode })],
			});
			await resourceLoader.reload();
			assert.deepEqual(resourceLoader.getExtensions().errors, []);
			({ session } = await sdk.createAgentSession({
				cwd: directory, agentDir: directory, settingsManager, modelRuntime, resourceLoader,
				sessionManager: sdk.SessionManager.inMemory(directory),
			}));
			const errors = [];
			session.extensionRunner.onError((error) => errors.push(error));
			// Exercise the reported tool-toggle session_start -> setActiveTools path.
			await session.bindExtensions({});
			const active = session.getActiveToolNames();
			for (const name of ["session_search", "session_query"]) {
				assert.ok(active.includes(name));
				// Also exercise later restriction/restoration, as other extensions do.
				session.setActiveToolsByName(active.filter((tool) => tool !== name));
				session.setActiveToolsByName(active);
			}
			// Pi reports prepareLoadout errors instead of throwing them to the caller.
			assert.deepEqual(errors.map(({ event, error }) => ({ event, error })), []);
			for (const name of ["session_search", "session_query"]) {
				const tool = session.getAllTools().find((tool) => tool.name === name);
				assert.equal(typeof tool?.description, "string");
				assert.ok(tool.description.trim().length > 0);
			}
		} finally {
			session?.dispose();
			await rm(directory, { recursive: true, force: true });
		}
	});
}
