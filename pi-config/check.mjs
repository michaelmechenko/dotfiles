#!/usr/bin/env node
/** Network-free consistency checks for the tracked Pi configuration. */
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

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
check(settings.defaultProvider === "openai-codex" && settings.defaultModel === "gpt-6-astra", "Pi default must be openai-codex/gpt-6-astra");
check(JSON.stringify(settings.enabledModels) === JSON.stringify(["openai-codex/*"]), "enabled models must exclude retired Ollama Cloud");
check(!existsSync(join(agent, "models.json")), "retired custom models.json must remain absent");

const extensionNames = readdirSync(join(agent, "extensions")).filter((name) => existsSync(join(agent, "extensions", name, "index.ts"))).sort();
const extensions = new Set(extensionNames);
for (const required of ["plan-mode", "tool-toggle", "web-tools"]) {
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
const packageSources = (settings.packages ?? []).map((entry) => typeof entry === "string" ? entry : entry.source);
checkInventory("packages", packageSources);
check(readme.includes(`\`${settings.defaultProvider}\` / \`${settings.defaultModel}\``), "README default provider/model differs from settings.json");
for (const pattern of settings.enabledModels ?? []) check(readme.includes(`\`${pattern}\``), `README enabled-model inventory missing: ${pattern}`);

const diff = read("agent/extensions/diff/src/index.ts");
check(diff.includes("withFileMutationQueue"), "diff mutations must use Pi's file mutation queue");
check(!diff.includes("isError: !result.ok"), "diff errors must use Pi-supported error semantics");
check(!diff.includes("getEditOperations(args)"), "edit renderer must use normalizeEditOperations");
check(!existsSync(join(agent, "extensions", "diff", "src", "hashline.ts")), "retired diff hashline implementation still exists");
check(!read("agent/extensions/diff/package.json").includes("xxhash-wasm"), "retired diff hash dependency still exists");
check(!existsSync(join(agent, "extensions", "plan-mode", "execution-orchestrator.ts")), "retired parallel-plan orchestrator still exists");
check(!existsSync(join(agent, "extensions", "tool-display", "HANDOFF.md")), "stale tool-display handoff still exists");
const subagentSource = read("agent/extensions/subagent/index.ts");
const prettySource = read("agent/extensions/pretty/src/index.ts");
check(subagentSource.includes('pi.on("tool_result"'), "subagent failures must patch Pi tool_result errors");
check(prettySource.includes('pi.on("tool_result"'), "pretty failures must patch Pi tool_result errors");

const nixPi = read("../nix/home/pi.nix");
const nixLens = read("../nix/packages/pi-lens.nix");
const nixBtw = read("../nix/packages/pi-btw.nix");
const shell = read("../zshrc");
for (const source of ["piLens", "piBtw"]) check(nixPi.includes(`source = "\${${source}}"`), `Nix Pi settings missing ${source} package source`);
check(nixPi.match(/source = "\$\{piLens\}"; skills = \[ \];/) && nixPi.match(/source = "\$\{piBtw\}"; skills = \[ \];/), "Lens/BTW package skills must stay disabled");
check(nixLens.includes('owner = "michaelmechenko"') && nixLens.includes('rev = "5e27080a3855dba5a2263f7e3b043e8d7385c3a5"') && !nixLens.includes("patches ="), "Lens derivation pin drifted");
check(nixBtw.includes('owner = "michaelmechenko"') && nixBtw.includes('rev = "3241ec5f541367e17bff3d5ccf0c9cbca71a04ea"') && !nixBtw.includes("patches ="), "BTW derivation pin drifted");
for (const variable of ["PI_LENS_CONFIG_PATH", "PI_LENS_DISABLE_LSP_INSTALL", "PI_LENS_DISABLE_TOOL_INSTALL", "PI_LENS_DISABLE_TOOL_REFRESH", "PI_LENS_DISABLE_MUTATIONS", "PI_LENS_NO_CONTEXT_INJECTION", "PI_BTW_FOCUS_KEYS", "PI_BTW_WIDTH_KEY"]) {
  check(nixPi.includes(variable), `Nix Pi environment missing ${variable}`);
  check(shell.includes(variable), `shell environment missing ${variable}`);
}
const lensConfig = JSON.parse(read("agent/pi-lens-global.json"));
check(!existsSync(join(agent, "extensions/pi-lens.json")), "Lens global config must not use the reserved project-config basename under extensions");
check(nixPi.includes('"pi-config/agent/pi-lens-global.json".source = liveResource "pi-lens-global.json";'), "Nix must expose the tracked Lens global config");
check(shell.includes('PI_LENS_CONFIG_PATH="$PI_CODING_AGENT_DIR/pi-lens-global.json"'), "shell Lens global config path drifted");
check(lensConfig.lsp?.enabled === true, "Lens LSP must be enabled");
check(lensConfig.format?.enabled === false && lensConfig.autofix?.enabled === false && lensConfig.contextInjection?.enabled === false, "Lens mutation/context defaults must stay disabled");
check(lensConfig.tools?.lsp_navigation?.enabled === true && lensConfig.tools?.lens_diagnostics?.enabled === true, "Lens navigation/diagnostic tools must stay enabled");

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

if (failures.length) {
  console.error("Pi configuration checks failed:");
  for (const failure of failures) console.error(`- ${failure}`);
  process.exitCode = 1;
} else {
  console.log("Pi configuration checks passed.");
}
