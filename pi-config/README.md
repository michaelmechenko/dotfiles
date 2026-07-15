# pi-config

This is the user config directory for [pi](https://github.com/earendil-works/pi), wired up via
`PI_CODING_AGENT_DIR=~/.config/pi-config/agent` (set in `~/.config/zshrc`). Pi's default `~/.pi`
is not used here.

Everything under `agent/` is auto-discovered by pi except where noted. After changing extensions,
agents, or prompts, run `/reload` inside a pi session to pick up changes without restarting.

## Layout

```
agent/
├── settings.json      # global settings + installed npm/git packages
├── keybindings.json   # keybinding overrides
├── AGENTS.md          # global instructions (communication style, coding conventions)
├── themes/            # custom TUI themes
├── extensions/         # <name>/index.ts, auto-discovered. Uniform naming: no `pi-` prefix, no `.ts` suffix
├── agents/             # subagent definitions (*.md with YAML frontmatter), used by extensions/subagent
├── prompts/            # prompt templates (/name expansion), used by extensions/subagent
├── skills/             # SKILL.md-based skills (not yet populated)
├── auth.json           # provider credentials — do not inspect/print/edit
└── sessions/            # per-project transcript logs — session/cache artifact, do not edit
```

## Settings (`agent/settings.json`)

- `theme`: `"vague"` — palette-aligned custom theme, see `agent/themes/vague.json` and `~/.config/COLORS.md`.
- `defaultProvider` / `defaultModel`: `anthropic` / `claude-sonnet-5`.
- `defaultProjectTrust: "always"` — new projects are trusted without prompting.
- `packages`: npm packages managed via `pi install` / `pi remove` (see [Packages](#packages) below).

## Extensions (`agent/extensions/`)

All extensions are directories with a top-level `index.ts` (`extensions/<name>/index.ts`), even the
ones that are a single file internally. Naming is uniform across the board: no `pi-` prefix (the
directory already lives under pi's `extensions/`, so the prefix is redundant), no `.ts` suffix (the
file extension isn't part of the extension's identity), plain `kebab-case` names throughout.

### Vendored from pi's own `examples/extensions/`

| Extension | What it does |
|---|---|
| `bookmark/` | `/bookmark [label]` — labels the last assistant message for quick `/tree` navigation |
| `session-name/` | `/session-name [name]` — friendly session names in the session selector |
| `protected-paths/` | Blocks `write`/`edit` to protected paths. Tuned for this repo: adds `auth.json`, `.ssh/`, `id_rsa`, `.pem` to upstream's `.env`, `.git/`, `node_modules/` |
| `permission-gate/` | Confirms before dangerous bash (`rm -rf`, `sudo`, `chmod/chown 777`). Tuned for this repo: `rm`/`chmod`/`chown` auto-allow without a prompt when every path argument resolves inside `/tmp`, `/private/tmp`, or `$TMPDIR` (scratch/test dirs), with `..`-traversal guarded against escaping that confinement. `sudo` never auto-allows regardless of path. Also de-emoji'd (see [Emoji policy](#emoji-policy)) |
| `minimal-mode/` | Extra Ctrl+O display mode: collapsed tool calls with no output shown |
| `tools/` | `/tools` — interactive enable/disable UI for active tools, persists across resume |
| `titlebar-spinner/` | Braille spinner in the terminal title bar while the agent works |
| `hidden-thinking-label/` | `/thinking-label [text]` — customize the label shown for collapsed thinking blocks |
| `plan-mode/` | `/plan` read-only planning mode: disables write/edit, allowlists safe bash, tracks `Plan:` steps with `[DONE:n]` markers and a progress widget. De-emoji'd: status/widget glyphs (📋, ⏸, ☑, ☐) replaced with plain text/`[x]`/`[ ]` |
| `subagent/` | Delegate tasks to isolated `pi` subprocess agents (single/parallel/chain modes); see [Agents & Prompts](#agents--prompts) |

These were originally flat `<name>.ts` files (pi's own convention for simple examples); each was
moved to `<name>/index.ts` here to match this repo's uniform extension-directory naming.

### Duplicated from `davis7dotsh/my-pi-setup`'s `ui-customization/index.ts`

| Extension | What it does |
|---|---|
| `footer/` | Faithful reimplementation of pi's *built-in* footer (same token/cache/cost math, right-aligned model/provider/thinking), with four deliberate deviations: (1) bottom-left stats grouped with `•` separators (`↑196 ↓68k • R8.1M W902k • CH98.9% $4.552 • 16.6%/1.0M (auto)`); (2) top-left shows `directory (origin/branch) (worktree/name)` instead of `directory (branch)` — origin/branch from the configured upstream via `git rev-parse --abbrev-ref --symbolic-full-name @{u}`, worktree segment only when cwd is a linked worktree (`git rev-parse --git-dir` vs `--git-common-dir` diverge); (3) top-right shows the `lsp` extension's status instead of being empty, excluded from the generic bottom status lines so it isn't duplicated; (4) the **entire footer renders in one uniform color** (`dim`) — unlike the built-in footer, context% is not colored orange/red past 70%/90%. `/builtin-footer` restores the real (multi-color) default |
| `header/` | Custom header: a plain "pi" wordmark (not upstream's block-drawing "PI" art or a `p`/`i`-character pixel-art logo, and not upstream's companion git-info/model-info dashboard), a directory subtitle, and an enabled/disabled extension-count summary line listing disabled extension names when any are disabled (via the same `DefaultPackageManager`/`SettingsManager` resolution `extension-toggle` uses). Extension display names are derived from the path segment immediately after `extensions/`, not the immediate parent directory of the entry point — needed because `skill-toggle`'s real entry point is nested at `skill-toggle/src/index.ts`, and naively taking the immediate parent would misreport it as `src`. `/builtin-header` restores the default |

Upstream combines both in one `ui-customization/index.ts` file backed by companion `git-info`/
`model-info` extensions (a pub/sub dashboard-state channel). Split into two separate extensions here
to keep each one small and self-contained, and rewired to pi's own built-in data sources
(`footerData.getGitBranch()`, `ctx.getContextUsage()`, `ctx.model`) instead of vendoring the
companion extensions and their event-bus plumbing — not requested, and out of scope. Colors use the
active theme's `accent`/`muted`/`text`/`dim` roles, not hardcoded hex, per this repo's palette
discipline (see `~/.config/COLORS.md`).

### Vendored from `dmmulroy-config/home/.pi/agent/extensions/`

| Extension | What it does |
|---|---|
| `answer/` | `/answer` or Ctrl+. — extracts unanswered questions from the last assistant message into an interactive Q&A form, then replies with the answers |
| `skill-toggle/` | UI for enabling/disabling discovered skills by patching their frontmatter. Upstream's actual entry point is `src/index.ts`, only picked up automatically when installed as a pi package via its `package.json` manifest. Since this is a plain drop-in (not `pi install`ed), a top-level `index.ts` was added that re-exports it (`export { default } from "./src/index.ts";`) so pi's directory auto-discovery (`extensions/*/index.ts`) actually finds it — renamed from `pi-skill-toggle` in the process, this fix was previously missing and the extension was silently inert |
| `save-md/` | `/save-md name` — saves the latest assistant response as `name.md` |
| `web-tools/` | `webfetch` (fetch a URL as markdown/text/html, SSRF-guarded) and `websearch` (Exa-backed web search) tools. **Forked, not a straight copy** — see [Web search/browse tooling](#web-searchbrowse-tooling) below |

### Vendored from `davis7dotsh/my-pi-setup`

| Extension | What it does |
|---|---|
| `ask-user/` | `ask_user` tool — lets the model ask a single multiple-choice question (2-5 options + "write my own answer") via a popup UI. Needs its own `node_modules` (depends on `effect`); already installed with `npm install --ignore-scripts` (skips its `effect-tsgo patch` dev-only prepare script) |

### Forked locally from `@ogulcancelik/pi-extensions` (no longer npm-managed)

| Extension | What it does |
|---|---|
| `goal/` | `/goal <objective>` — Codex-style long-running goal mode. Keeps state append-only in session, auto-continues across turns, and hands off to a linked new session at ~95% context usage via `goal_handoff` |
| `session-recall/` | `session_search` (literal text search across past sessions) and `session_query` (LLM Q&A over a specific past session) tools, plus `/session-recall` to pick the query model |

These two were pulled out of `settings.json`'s `packages` array (originally `@ogulcancelik/pi-goal`
and `@ogulcancelik/pi-session-recall`) and copied into `extensions/` directly — renamed to drop the
`pi-` prefix, and their single upstream `.ts` file moved to `<name>/index.ts` — so they're versioned
in this repo instead of tracking an external npm release. To pick up upstream changes, diff against
`npm view @ogulcancelik/pi-goal` / `npm view @ogulcancelik/pi-session-recall` and re-copy by hand —
there's no `pi update` path for a forked-local extension.

### Forked locally from `@petechu/pi-extension-toggle` (no longer npm-managed)

| Extension | What it does |
|---|---|
| `extension-toggle/` | `/extension-toggle` (or Ctrl+Shift+E) — interactive picker to enable/disable extensions, skills, prompts, and themes, for both npm/git package sources and bare top-level auto-discovered resources (like everything in this repo's `agent/extensions/`). Writes `-path`/`+path` filter entries into `settings.json` (pi's native resource-array filter syntax); no file renaming involved. This is the "skill-toggle, but for extensions" capability — skill-toggle patches skill frontmatter, this patches settings.json filters, since extensions have no frontmatter equivalent |

Had no runtime dependencies beyond pi's own peer packages, so it copies straight across (`index.ts`,
`utils.ts`) with no `npm install` step. Its self-exclusion check (hiding itself from its own picker)
already matches on the literal path segment `/extension-toggle/`, so renaming the vendored directory
from the npm package's implicit name to `extension-toggle/` needed no code changes. `header/`'s
enabled/disabled extension summary (above) reuses the same `DefaultPackageManager`/`SettingsManager`
resolution this extension uses internally. To pick up upstream changes, diff against
`npm view @petechu/pi-extension-toggle` and re-copy `index.ts`/`utils.ts` by hand.

## Packages (`agent/settings.json` → `packages`, npm-managed)

Installed via `pi install npm:<name>` (writes here automatically; `pi update --extensions` reconciles):

| Package | Purpose |
|---|---|
| `@ff-labs/pi-fff` | Replaces built-in `find`/`grep` with FFF (Rust-native, SIMD-accelerated, frecency-ranked, git-aware, no subprocess spawn) |
| `@dreki-gg/pi-lsp` | Generic LSP integration — one `lsp` tool with 11 operations (diagnostics, hover, go-to-definition, references, symbols, call hierarchy, code actions). Config-driven; all servers **disabled by default** — enable per-project in `.pi/lsp.json` or globally in `agent/extensions/lsp/config.json` |
| `pi-ast-grep` | Generic AST search — one `ast_grep` tool wrapping the `ast-grep` CLI (`run`/`scan`). **Read-only in v0**, no rewrite mode. For structural rewrites, invoke the `ast-grep` CLI directly via `bash` (`ast-grep run -p '<pattern>' -r '<rewrite>' -U`) |


Installed package sources live under `agent/npm/node_modules/` (gitignored — see `agent/npm/.gitignore`
and the repo-root `.gitignore` entry for `agent/extensions/*/node_modules`).

## Agents & Prompts

`agent/agents/*.md` and `agent/prompts/*.md` back the `subagent` extension:

- **Agents** (user-level, always loaded): `scout` (fast recon, Haiku), `planner` (implementation plans, Sonnet), `reviewer` (code review, Sonnet), `worker` (general-purpose, Sonnet, full tools).
- **Prompts** (workflow presets): `/implement` (scout → planner → worker), `/scout-and-plan` (scout → planner), `/implement-and-review` (worker → reviewer → worker).

Project-local `.pi/agents/*.md` only load if a subagent call passes `agentScope: "both"` or `"project"` — see `extensions/subagent/README.md`.

## Skills (`agent/skills/`)

Not yet populated. When skills are added, document them here following the same table format as
extensions above (name, source/provenance, one-line purpose), and note any project-local
`.pi/skills/` or `.agents/skills/` interplay.

## Web search/browse tooling

`web-tools/` (forked from `dmmulroy-config`) is installed. Two alternatives were evaluated and not chosen:

| Option | Pros | Cons |
|---|---|---|
| **`web-tools/` (chosen)** | Lightest — plain `webfetch`/`websearch`, no browser/daemon, private-host/SSRF guards built in | No JS rendering — pages that need JS to render content fetch incomplete markdown/text |
| Exa MCP + `pi-mcp-bridge` | Standard MCP protocol, reusable config across MCP clients, bridge itself is minimal/dependency-free | Extra process (MCP server + bridge), chattier tool schemas |
| `@ogulcancelik/pi-web-browse` | Real headless Chrome (CDP) — handles JS/Cloudflare, no per-query API cost, warm daemon | Heaviest option — needs a real browser install, background daemon + hidden profile, slower cold start |

### Fork changes from upstream `dmmulroy-config/home/.pi/agent/extensions/web-tools/`

Upstream's `websearch` called `https://m.mulroy.dev/m/e` — dmmulroy's personal proxy in front of Exa,
with no caller-side API key. Since we have our own `$EXA_API_KEY`, the fork instead calls Exa's
official hosted MCP endpoint directly:

- `settings.ts` — `searchEndpoint` default changed to `https://mcp.exa.ai/mcp`; added `readExaApiKey()`
  which reads `process.env.EXA_API_KEY` into the settings' new `search.apiKey` field (wrapped in
  `Redacted` so it can't be accidentally logged/serialized).
- `types.ts` — added `search.apiKey?: Redacted<string>` to `WebToolsSettings`.
- `providers/exa.ts` — `ExaSearchProvider` takes an optional `apiKey` constructor param, sends it as
  the `x-api-key` header (the header Exa's docs specify for `mcp.exa.ai`), and returns a clear
  `SearchProviderReturnedError` ("EXA_API_KEY is not set") instead of making an unauthenticated call
  when the key is missing.
- `websearch.ts` — `createSearchProvider` unwraps `settings.apiKey` via `Redacted.value()` and passes
  it through to `ExaSearchProvider`.

The JSON-RPC `tools/call` / `web_search_exa` request shape and the MCP/SSE response parsing
(`providers/exa-protocol.ts`, `providers/exa-results.ts`) are untouched — confirmed against Exa's
real `mcp.exa.ai` endpoint, which speaks the same protocol dmmulroy's proxy did.

Needs its own `npm install --ignore-scripts` in `extensions/web-tools/` (deps: `html-to-text`,
`linkedom`, `turndown`, `turndown-plugin-gfm`) — already done; re-run after any dependency bump.

## Naming convention

Every entry in `agent/extensions/` is `<name>/index.ts` — a directory, never a bare `<name>.ts` file,
and never prefixed with `pi-`. This applies to locally vendored/forked extensions only; npm-managed
packages in the `packages` array (see below) keep their real upstream package names (`@ff-labs/pi-fff`,
`@dreki-gg/pi-lsp`, `pi-ast-grep`) since those are fixed identifiers pi itself tracks for `pi
update`/`pi list` — renaming them isn't possible without forking them too.

## Emoji policy

`AGENTS.md` (Communication section) directs the model not to use emoji/pictograph symbols (⚠️, 📋, ✅, etc.) in its own output unless explicitly asked. This is separate from, but consistent with, extension-level cleanup: `permission-gate` and `plan-mode` had hardcoded pictograph glyphs (⚠, 📋, ⏸, ☑, ☐) removed in favor of plain text/ASCII (`[x]`/`[ ]`). Plain typographic symbols already used idiomatically across vendored TUI extensions (✓/✗ status marks, →/↑/↓ arrows, ❯ bullets, ✦ spinners) are not emoji and were left as-is — rewriting those would touch nearly every vendored extension for no behavioral benefit.

## Maintenance

- Extensions with real npm dependencies (currently only `ask-user/`) need their own `npm install`
  in that subdirectory after any upstream re-sync. Use `--ignore-scripts` if the upstream
  `package.json` has a dev-only `prepare` script (as `ask-user` does).
- `pi list` / `pi update --extensions` manage the npm-installed `packages` array only — vendored
  and forked extensions are plain files in this repo and update by hand.
- `pi -p "..." ` (print mode) is a fast way to sanity-check that all extensions still load without
  throwing after a change — no session/session-recall artifacts are meant to persist from that,
  clean up `agent/sessions/--<slug>--/` if a throwaway cwd leaks a session dir.
