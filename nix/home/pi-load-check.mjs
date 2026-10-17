#!/usr/bin/env node
// Load-only Nix integration check: no session, session_start hooks or model.
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, readdirSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { pathToFileURL } from "node:url";

const [sdkRoot, settingsPath, extensionsPath, runtimePath] = process.argv.slice(2);
assert(sdkRoot && settingsPath && extensionsPath && runtimePath, "missing Nix inputs");
const root = mkdtempSync(join(tmpdir(), "nixos-pi-load-"));
const timer = setTimeout(() => { console.error("Pi extension loading timed out"); process.exit(1); }, 30_000);
try {
  const cwd = join(root, "project"), agentDir = join(root, "agent");
  mkdirSync(cwd); mkdirSync(agentDir);
  process.chdir(cwd); // Factories using process.cwd() must also stay isolated.
  process.env.HOME = root;
  process.env.XDG_CONFIG_HOME = join(root, "config");
  process.env.XDG_CACHE_HOME = join(root, "cache");
  process.env.XDG_STATE_HOME = join(root, "state");
  process.env.PI_CODING_AGENT_DIR = agentDir;
  process.env.PI_OFFLINE = "1";
  for (const key of Object.keys(process.env)) {
    if (key.startsWith("PI_INTERCOM_") || ["TMUX", "TMUX_PANE", "HERDR_PANE_ID"].includes(key)) delete process.env[key];
  }
  process.env.PI_LENS_HOME = join(root, "lens");
  process.env.PI_LENS_CONFIG_PATH = join(root, "lens-config.json");
  for (const key of ["PI_LENS_DISABLE_LSP_INSTALL", "PI_LENS_DISABLE_TOOL_INSTALL",
    "PI_LENS_DISABLE_TOOL_REFRESH", "PI_LENS_DISABLE_MUTATIONS", "PI_LENS_NO_CONTEXT_INJECTION"]) process.env[key] = "1";
  writeFileSync(process.env.PI_LENS_CONFIG_PATH, JSON.stringify({ lsp: { enabled: false }, contextInjection: { enabled: false } }));
  const settings = JSON.parse(readFileSync(settingsPath, "utf8"));
  writeFileSync(join(agentDir, "settings.json"), JSON.stringify(settings));
  symlinkSync(extensionsPath, join(agentDir, "extensions"), "dir");
  symlinkSync(runtimePath, join(agentDir, "npm"), "dir");
  // Fails closed if a resource attempts a fetch during registration.
  globalThis.fetch = async () => { throw new Error("network is forbidden during the load check"); };
  const { DefaultResourceLoader, SettingsManager } = await import(pathToFileURL(join(sdkRoot, "dist/index.js")).href);
  const loader = new DefaultResourceLoader({
    cwd, agentDir, settingsManager: SettingsManager.create(cwd, agentDir),
    noContextFiles: true, noThemes: true, noPromptTemplates: true, noSkills: true,
  });
  await loader.reload();
  const result = loader.getExtensions();
  assert.deepEqual(result.errors, [], JSON.stringify(result.errors));
  const loaded = new Set(result.extensions.map(extension => realpathSync(extension.resolvedPath ?? extension.path)));
  const disabled = new Set((settings.extensions ?? []).filter(p => p.startsWith("-extensions/")).map(p => p.slice("-extensions/".length).split("/")[0]));
  for (const entry of readdirSync(extensionsPath, { withFileTypes: true })) {
    if (!entry.isDirectory() || disabled.has(entry.name)) continue;
    const path = join(extensionsPath, entry.name, "index.ts");
    assert(loaded.has(realpathSync(path)), `extension not loaded: ${entry.name}`);
  }
  const tools = new Set(result.extensions.flatMap(extension => [...extension.tools.keys()]));
  const commands = new Set(result.extensions.flatMap(extension => [...extension.commands.keys()]));
  for (const name of ["ast_grep", "intercom", "lens_diagnostics", "lsp_navigation"]) assert(tools.has(name), `missing tool: ${name}`);
  assert(commands.has("btw"), "missing BTW command");
  for (const entry of settings.packages.filter(p => typeof p === "object")) {
    assert(result.extensions.some(extension => (extension.resolvedPath ?? extension.path).startsWith(entry.source + "/")),
      `store package not loaded: ${entry.source}`);
  }
  const intercom = JSON.parse(readFileSync(join(runtimePath, "node_modules/pi-intercom/package.json"), "utf8"));
  assert.equal(intercom.version, "0.16.0");
  console.log(`Pi load check: ${result.extensions.length} extensions; local npm, Lens and BTW registrations passed (no session/network).`);
} finally {
  clearTimeout(timer);
  rmSync(root, { recursive: true, force: true });
}
