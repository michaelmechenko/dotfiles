#!/usr/bin/env node
/** Network-free consistency checks for the tracked Pi configuration. */
import { accessSync, constants, existsSync, readdirSync, readFileSync } from "node:fs";
import { delimiter, join } from "node:path";

const root = new URL(".", import.meta.url).pathname;
const agent = join(root, "agent");
const settings = JSON.parse(readFileSync(join(agent, "settings.json"), "utf8"));
const read = (path) => readFileSync(join(root, path), "utf8");
const failures = [];
const check = (condition, message) => { if (!condition) failures.push(message); };
const resourceExists = (filter) => existsSync(join(agent, filter.replace(/^[+-]/, "")));

for (const key of ["extensions", "skills", "prompts"]) {
  for (const filter of settings[key] ?? []) {
    check(resourceExists(filter), `stale settings ${key} filter: ${filter}`);
  }
}

check(settings.defaultProjectTrust === "ask", "defaultProjectTrust must be 'ask'");
check(settings.compaction?.enabled === true, "auto-compaction must be enabled");
check(!settings.extensions?.includes("-extensions/permission-gate/index.ts"), "permission-gate must be enabled");

const extensionNames = readdirSync(join(agent, "extensions")).filter((name) => existsSync(join(agent, "extensions", name, "index.ts"))).sort();
const extensions = new Set(extensionNames);
for (const required of ["protected-paths", "permission-gate", "plan-mode", "tool-toggle", "lsp-startup", "web-tools"]) {
  check(extensions.has(required), `required extension missing: ${required}`);
}

const readme = read("README.md");
function documentedInventory(name) {
  const match = new RegExp(`<!-- inventory:${name} -->([\\s\\S]*?)<!-- \\/inventory:${name} -->`).exec(readme);
  return match ? [...match[1].matchAll(/`([^`]+)`/g)].map((item) => item[1]).sort() : [];
}
function checkInventory(name, actual) {
  const documented = documentedInventory(name);
  check(JSON.stringify(documented) === JSON.stringify([...actual].sort()), `${name} inventory differs from pi-config/README.md`);
}
checkInventory("extensions", extensionNames);
checkInventory("skills", readdirSync(join(agent, "skills")).filter((name) => existsSync(join(agent, "skills", name, "SKILL.md"))));
checkInventory("prompts", readdirSync(join(agent, "prompts")).filter((name) => name.endsWith(".md")));
checkInventory("packages", settings.packages ?? []);
check(readme.includes(`\`${settings.defaultProvider}\` / \`${settings.defaultModel}\``), "README default provider/model differs from settings.json");
for (const pattern of settings.enabledModels ?? []) check(readme.includes(`\`${pattern}\``), `README enabled-model inventory missing: ${pattern}`);

const protectedPaths = read("agent/extensions/protected-paths/path-policy.ts");
check(protectedPaths.includes('"apply_patch"'), "protected paths must cover apply_patch");
check(!protectedPaths.includes("path.includes(p)"), "protected paths must not use substring matching");

const diff = read("agent/extensions/diff/src/index.ts");
check(diff.includes("withFileMutationQueue"), "diff mutations must use Pi's file mutation queue");
check(!diff.includes("isError: !result.ok"), "diff errors must use Pi-supported error semantics");
check(!existsSync(join(agent, "extensions", "diff", "src", "hashline.ts")), "retired diff hashline implementation still exists");
check(!read("agent/extensions/diff/package.json").includes("xxhash-wasm"), "retired diff hash dependency still exists");
check(!existsSync(join(agent, "extensions", "plan-mode", "execution-orchestrator.ts")), "retired parallel-plan orchestrator still exists");
check(!existsSync(join(agent, "extensions", "tool-display", "HANDOFF.md")), "stale tool-display handoff still exists");
const subagentSource = read("agent/extensions/subagent/index.ts");
const prettySource = read("agent/extensions/pretty/src/index.ts");
check(subagentSource.includes('pi.on("tool_result"'), "subagent failures must patch Pi tool_result errors");
check(prettySource.includes('pi.on("tool_result"'), "pretty failures must patch Pi tool_result errors");

const researcher = read("agent/agents/researcher.md");
check(/tools:\s*\[[^\]]*\bwrite\b/.test(researcher), "researcher must be allowed to write its cited brief");
const implementSkill = read("agent/skills/implement/SKILL.md");
for (const filter of settings.skills ?? []) {
  if (!filter.startsWith("-skills/")) continue;
  const name = filter.split("/")[1];
  check(!implementSkill.includes(`\`${name}\` skill`), `implement skill depends on disabled skill: ${name}`);
}
check(!read("agent/skills/interface-kit/SKILL.md").includes("design-system skill"), "interface-kit references a nonexistent design-system skill");

const keybinds = read("../KEYBINDS.md");
for (const binding of ["ctrl+.", "ctrl+e", "ctrl+shift+e", "ctrl+s", "ctrl+shift+o", "ctrl+l", "ctrl+shift+p", "alt+enter", "ctrl+enter"]) {
  check(keybinds.includes(binding), `KEYBINDS.md missing Pi binding: ${binding}`);
}

const trackedLsp = JSON.parse(read("agent/extensions/lsp/config.json"));
const searchPath = process.env.PATH?.split(delimiter) ?? [];
function onPath(command) {
  return searchPath.some((dir) => {
    try { accessSync(join(dir, command), constants.X_OK); return true; } catch { return false; }
  });
}
function checkLspExecutables(config, label) {
  for (const [name, server] of Object.entries(config?.lsp ?? {})) {
    if (server.disabled || !Array.isArray(server.command) || !server.command[0]) continue;
    check(onPath(server.command[0]), `${label} enabled LSP direct executable unavailable: ${name} (${server.command[0]})`);
  }
}
checkLspExecutables(trackedLsp, "tracked");
const packageConfigSource = join(agent, "npm", "node_modules", "@dreki-gg", "pi-lsp", "extensions", "lsp", "config.ts");
if (existsSync(packageConfigSource) && readFileSync(packageConfigSource, "utf8").includes("join(home, '.pi', 'agent'")) {
  const legacyConfig = join(process.env.HOME ?? "", ".pi", "agent", "extensions", "lsp", "config.json");
  if (existsSync(legacyConfig)) checkLspExecutables(JSON.parse(readFileSync(legacyConfig, "utf8")), "live legacy");
  check(read("agent/extensions/lsp-startup/index.ts").includes("packageUsesLegacyConfigRoot"), "lsp-startup does not report the installed package's legacy config root");
}

if (failures.length) {
  console.error("Pi configuration checks failed:");
  for (const failure of failures) console.error(`- ${failure}`);
  process.exitCode = 1;
} else {
  console.log("Pi configuration checks passed.");
}
