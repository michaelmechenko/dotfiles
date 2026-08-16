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
├── skills/             # SKILL.md-based skills, see Skills section below
├── auth.json           # provider credentials — do not inspect/print/edit
└── sessions/            # per-project transcript logs — session/cache artifact, do not edit
```

Pi names each project transcript directory by removing the cwd's leading `/`,
replacing its remaining `/` characters with `-`, and wrapping the result in `--`.
Dots remain literal. For example, `/Users/mishka/.config` is
`agent/sessions/--Users-mishka-.config--`. This remains a legacy compatibility
lookup only: `extensions/session-state/` publishes the authoritative live
PID → session ID/file/cwd record under `/tmp/pi-session-state/`, so tmux can
identify concurrent same-cwd sessions exactly. Do not reuse Claude Code's different
project-slug convention.

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
| `working-indicator-off/` | Disables pi's animated inline working spinner (`ctx.ui.setWorkingIndicator({ frames: [] })`) to avoid tmux redraw issues |
| `thinking-label/` | Lowercases the "Thinking..." placeholder shown for collapsed thinking blocks (`hideThinkingBlock: true`) to `thinking...`, via `ctx.ui.setHiddenThinkingLabel()`. A prior `hidden-thinking-label/` extension exposed this as a full `/thinking-label [text]` command and was removed as unneeded; this is a fixed, no-command replacement |
| `plan-mode/` | Structured plan workflow plus separate restricted access modes. `Ctrl+P` cycles `none → plan → read-only → none`; plan exposes read-only tools plus `plan_update`, while standalone read-only exposes only the shared positive allowlist. `plan_update` requires an execution brief (summary, findings, decisions, relevant files with notes, constraints); v2/v3 plans migrate with an empty brief and need recalibration. Kickoff, resume, and recalibration share one canonical context renderer, while recurring execution guidance stays in the per-turn system prompt. `/plan-review` executes through one toggle/settings screen with explicit Execute and Cancel actions: current session, clipboard, a new parent-linked session in the current tmux pane, a detached pane, or a detached window. The new current-pane session receives only the private canonical execution packet; its fresh extension instance activates the model/tools and starts execution. Detached panes default below and offer a Below/Right placement toggle; all spawned Pi sessions fall through to an interactive login shell on exit. Tmux choices appear only when the source target resolves; detached launches preserve source focus and cwd, and source state changes only after the child consumes its private handoff packet and acknowledges startup. Model policy defaults to the saved plan default and can be changed to current or choose, with provider/model/thinking and a choose-only save-default toggle; that default persists only after model activation or handoff acknowledgement succeeds. The destination defaults to a detached pane, falling back to the current session outside tmux. `plan_step` tracks progress and `plan_complete` records closeout. The saved execution default is only `agent/plan-mode.json`'s `executionModel`; temporary model switches restore Pi global defaults. `/todos`, `/plan-edit`, `/pause`, and `/plan-widget` remain available. |
| `subagent/` | Delegate tasks to isolated `pi` subprocess agents (single/parallel/chain modes); see [Agents & Prompts](#agents--prompts) |
| `prompt-stash/` | Claude Code-style Ctrl+S "stash or restore prompt": stashes and clears a non-empty editor, restores it on the next Ctrl+S press when the editor is empty. In-memory only (per pi process, cleared on `session_shutdown`); no cursor-position or pasted-image restore since pi's extension API doesn't expose those. Not vendored from anywhere — written directly against pi's `registerShortcut` + `ctx.ui.getEditorText`/`setEditorText` API. Ctrl+S collides with two built-in shortcuts: `app.models.save` (only live inside the `/scoped-models` picker) and `app.session.toggleSort` (only live inside the `/resume` session picker); `agent/keybindings.json` rebinds them to `ctrl+shift+s` and `ctrl+shift+r` respectively to resolve it — prompt-stash keeps the Claude Code-matching key |
| `session-state/` | Publishes an atomic, mode `0600` `/tmp/pi-session-state/<pid>.json` record on every `session_start` (including reload/new/resume/fork), containing the exact session ID, session file, and cwd; removes it on `session_shutdown`. `tmux-pi-session`, `tsave`, and mm-sidebar validate it against the live pi PID and cwd. |

These were originally flat `<name>.ts` files (pi's own convention for simple examples); each was
moved to `<name>/index.ts` here to match this repo's uniform extension-directory naming.

### Duplicated from `davis7dotsh/my-pi-setup`'s `ui-customization/index.ts`

| Extension | What it does |
|---|---|
| `footer/` | Faithful reimplementation of pi's *built-in* footer, with a quiet second line that shows only context usage plus the right-aligned model/provider/thinking display; top-left shows `directory (origin/branch) (worktree/name)` instead of `directory (branch)` — origin/branch from the configured upstream via `git rev-parse --abbrev-ref --symbolic-full-name @{u}`, worktree segment only when cwd is a linked worktree (`git rev-parse --git-dir` vs `--git-common-dir` diverge); top-right shows the `lsp` extension's status instead of being empty, excluded from the generic bottom status lines so it isn't duplicated; the **entire footer renders in one uniform color** (`dim`) — unlike the built-in footer, context% is not colored orange/red past 70%/90%. `/builtin-footer` restores the real (multi-color) default |
| `header/` | Custom header: a plain "pi" wordmark (not upstream's block-drawing "PI" art or a `p`/`i`-character pixel-art logo, and not upstream's companion git-info/model-info dashboard), a directory subtitle, and enabled/disabled extension-count and skill-count summary lines listing disabled names when any are disabled (via the same `DefaultPackageManager`/`SettingsManager` resolution `extension-toggle` uses, applied to both `resolved.extensions` and `resolved.skills`). Resource display names are derived from the path segment immediately after `extensions/`/`skills/`, not the immediate parent directory of the entry point — defensive, in case any local extension's entry point ever ends up nested (naively taking the immediate parent would misreport a nested entry like `<name>/src/index.ts` as `src`; see the `skill-toggle/` bullet below for why this bit pi core's own extension list). `/builtin-header` restores the default |

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
| `skill-toggle/` | `/skill-toggle` or Ctrl+Shift+E — both open the same persistent floating picker (pressing Ctrl+Shift+E again hides it, staged toggles intact; another press restores it — same hide/show pattern as `extension-toggle/`'s Ctrl+E) for enabling/disabling discovered skills by patching their frontmatter. Upstream's actual entry point is `src/index.ts`. A top-level `index.ts` shim re-exporting it (`export { default } from "./src/index.ts";`) exists for pi's directory auto-discovery (`extensions/*/index.ts`), but pi's `resolveExtensionEntries()` checks a directory's `package.json` `pi.extensions` manifest *first* and uses that path unconditionally if present — the shim never actually took effect while `package.json` still declared `"pi": { "extensions": ["./src/index.ts"] }`. That meant pi resolved the extension via `src/index.ts` directly, and pi core's own compact-label algorithm (visible in the startup `[Extensions]` context panel) strips the trailing `index.ts` and reports the immediate parent dir as the label — `src`, since it happened to be unique — instead of `skill-toggle`. Fixed by removing the manifest field from `package.json`, so discovery now falls through to the top-level shim and resolves to `skill-toggle/index.ts`, correctly labeled `skill-toggle` everywhere (not just in the `header` extension's own smarter labeling, which already special-cased this) |
| `save-md/` | `/save-md name` — saves the latest assistant response as `name.md` |
| `web-tools/` | `webfetch` (fetch a URL as markdown/text/html, SSRF-guarded) and `websearch` (Exa-backed web search) tools. **Forked, not a straight copy** — see [Web search/browse tooling](#web-searchbrowse-tooling) below |
| `whimsical/` | Randomizes the TUI's working-message text (`turn_start`/`turn_end`). Message list trimmed to 3, lowercase: `hmm...`, `erm...`, `uhh...` — upstream's ~300-entry whimsical list not used |

### Vendored from `davis7dotsh/my-pi-setup`

| Extension | What it does |
|---|---|
| `ask-user/` | `ask_user` tool — lets the model ask one contextual multiple-choice question (2-5 options + "write my own answer") via a popup UI. An optional context block states the investigation finding and decision impact before the question. The free-form answer editor accepts Ctrl+V text and clipboard images, returning pasted images to the model as image content. Concurrent calls (tool calls run in parallel) are serialized through a queue so they're shown one at a time instead of racing for overlay focus. Needs its own `node_modules` (depends on `effect`); already installed with `npm install --ignore-scripts` (skips its `effect-tsgo patch` dev-only prepare script) |

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
| `extension-toggle/` | `/extension-toggle` (or Ctrl+E) — interactive two-pane list + details picker (styled and driven like `skill-toggle/`: live search-as-you-type, space to stage, Ctrl+S to apply + reload) to enable/disable extensions, skills, prompts, and themes, for both npm/git package sources and bare top-level auto-discovered resources (like everything in this repo's `agent/extensions/`). Writes `-path`/`+path` filter entries into `settings.json` (pi's native resource-array filter syntax); no file renaming involved. This is the "skill-toggle, but for extensions" capability — skill-toggle patches skill frontmatter, this patches settings.json filters, since extensions have no frontmatter equivalent |

Had no runtime dependencies beyond pi's own peer packages, so it copies straight across (`index.ts`,
`utils.ts`) with no `npm install` step. Its self-exclusion check (hiding itself from its own picker)
already matches on the literal path segment `/extension-toggle/`, so renaming the vendored directory
from the npm package's implicit name to `extension-toggle/` needed no code changes. `header/`'s
enabled/disabled extension summary (above) reuses the same `DefaultPackageManager`/`SettingsManager`
resolution this extension uses internally. To pick up upstream changes, diff against
`npm view @petechu/pi-extension-toggle` and re-copy `index.ts`/`utils.ts` by hand.

### Locally written

| Extension | What it does |
|---|---|
| `finder/` | `open_in_finder` tool — opens/reveals a referenced local path in macOS Finder, or in ForkLift when `/Applications/ForkLift.app` is installed (auto-preferred, Finder fallback). Directories open as a pane/tab; files are revealed-and-selected in their parent folder. Resolves `@`-prefixed, `~`-home-relative, absolute, and cwd-relative paths (cwd-relative against `ctx.cwd`, same convention as the built-in file tools), validates existence via `stat` before invoking either app, then spawns the handler directly with an argv array (no shell, no Oh My Zsh `ofd` alias, no tmux dependency). **ForkLift path:** `/usr/bin/osascript -e 'tell application "ForkLift" to reveal path "<absPath>"'` (the `reveal` command from ForkLift's `Contents/Resources/ForkLift.sdef`); `reveal` does not steal focus and is a silent no-op on missing paths, which is why existence is checked first and `activate` is deliberately omitted. **Finder path (fallback or no ForkLift):** `/usr/bin/open <dir>` or `/usr/bin/open -R <file>`. On the first ForkLift call a brand-new install may prompt for Automation permission for the calling terminal (TCC is per source-app); the probe from this terminal ran unprompted. Used when the user asks to "open this folder in Finder" or reveal/show a file the agent just referenced; it only acts when explicitly requested and reports the resolved path plus which app handled it (`details.app: "forklift" \| "finder"`). macOS-only (throws on other platforms). |
| `tmux/` | `tmux` tool plus `/tmux`, `/tmux:cat`, and `/tmux:fork [below|right]` commands. `/tmux:fork` waits for Pi to become idle, duplicates the current active branch at its exact leaf into a new session file, and opens that fork in a detached pane below by default or right when requested, preserving source focus and cwd. Forked Pi falls through to a login shell when it exits. Pi's built-in `/fork` previous-message picker remains unchanged because built-in interactive commands cannot be disabled through the extension interface. Managed jobs expose only `run`, `attach`, `peek`, `list`, and `mute`; use argv-based tmux calls, private durable records, bounded capture output, one-shot silence/completion notifications, and Ghostty attachment without switching the source client. The public extension never offers session/window/pane deletion. |

### Local tool renderers and execution extensions

`pretty/` is a narrow visual override for `read` and `bash` only: syntax-highlighted reads and compact bash output. It does not register `find`, `grep`, or `ls`.

`diff/` retains the full custom `write`/`edit`/`apply_patch` renderer, transactional patch execution, and stale-edit guard.

`tool-display/` supplies the shared framing and `ctrl+shift+o` call/input-detail toggle used by multiline tool calls, while Pi's native `ctrl+o` controls `read`/`bash` and diff result detail, **and** a guarded host-level decorator over Pi’s `ToolExecutionComponent` that adds the same status-marker prefix and call/result divider to every tool that still uses Pi’s default `Box` shell (the built-in `find`/`grep`/`ls` and every extension tool that does not set `renderShell: "self"`). Its hybrid visual hierarchy keeps routine cards tint-only, while `write`/`edit`/`apply_patch`, `ask_user`, and every error card replace the left frame pad with a status-colored `▌` edge (pending = warning, success = success, error = error); this keeps the `width - 2` content budget unchanged. `read` and `bash` are self-shell and render their own error edges; the diff extension provides rich call/result content inside the default `Box`, so the decorator supplies its mutation/error edge. The decorator never touches `renderShell: "self"` tools, never re-implements any tool’s renderer, and falls back to Pi’s unmodified render on any error or unrecognized component shape. Other custom tools use Pi's default shell and result presentation where the decorator applies.

`image-proxy/` is a locally-written, image-only vision proxy (inspired by [`pungggi/pi-multimodal-proxy`](https://github.com/pungggi/pi-multimodal-proxy), scoped down to "I only care about reading images"). It exists so the configured text-only Ollama models can still understand images: when the active model lacks image input, attached/pasted images are described once by a fixed vision route and the description text is spliced into the user message in place of each image block, so the text model never receives an image block it can't render. An `analyze_image` tool lets the agent describe an explicit local image file (PNG/JPEG/GIF/WebP/BMP) on demand, regardless of the active model.

- **Fixed vision route:** `openai-codex/gpt-5.6-luna`, resolved from the existing catalog — no new provider is registered and no credentials are duplicated. Luna is already authenticated as the default model, so the route works with no extra setup. Changing the route means editing `VISION_PROVIDER`/`VISION_MODEL_ID` at the top of `image-proxy/index.ts` (no picker, no persisted config, by design).
- **Fallback only:** when the active model already supports images (the OpenAI/Codex and OpenCode GPT-5.x entries do), the proxy steps aside entirely — no analysis, no block replacement.
- **Two pieces:** `before_agent_start` analyzes attached images (in parallel, low reasoning) and stores results keyed by an image-data hash in a per-session `WeakMap`; `context` replaces image blocks in user messages with a fenced `<image_proxy_description>` block looked up by that hash, on every turn (so historical images stay described across turns). The `analyze_image` tool is a normal tool result — no injection, no stripping.
- **Deliberately omitted vs. upstream:** video, audio, YouTube download, image cropping, session image recall (`image="…"` ids), path auto-detection from prompt text, a model picker, persistent configuration, and per-session data-egress consent. Image data is sent to the configured Luna route by design — that is the whole point.
- **Tests:** `npm test` in `extensions/image-proxy/` runs pure-helper unit tests (path/MIME, fence building + close-tag neutralization, image-block replacement, hashing) via `node --experimental-strip-types --test` — no pi packages resolved at test time, no live model calls. The first extension in this repo to ship tests.

## Keybindings (`agent/keybindings.json`)

Only remaps pi's own closed, built-in `KEYBINDINGS` registry (namespaced ids like `tui.input.newLine`,
`app.session.toggleSort` — see `docs/keybindings.md`). Extensions that call `pi.registerShortcut(shortcut, ...)`
take a literal raw key combo (`KeyId`), not a namespaced id, so **there is no way to remap an
extension's shortcut via `keybindings.json`** — verified against `@earendil-works/pi-coding-agent`'s
`dist/core/extensions/types.d.ts` (`registerShortcut(shortcut: KeyId, ...)`) and `dist/core/keybindings.js`
(a closed table extensions can't add entries to). Documented here instead, as a plain reference:

| Extension | Hardcoded shortcut |
|---|---|
| `extension-toggle/` | `ctrl+e` |
| `skill-toggle/` | `ctrl+shift+e` |
| `prompt-stash/` | `ctrl+s` |
| `tool-display/` | `ctrl+shift+o` — toggle omitted multiline tool-call/input detail; `ctrl+o` remains Pi's built-in result-detail toggle for `read`, `bash`, diff, and default tool results |
| `plan-mode/` | `ctrl+p` cycles `none → plan → read-only → none` without opening a review dialog; `ctrl+alt+p` and `ctrl+alt+t` toggle the progress widget |
| `thinking-controls/` | `ctrl+tab` (Ghostty sends F13) — cycle the current model's thinking level backward; `shift+tab` remains Pi's forward cycle |
| `session-rename/` | `ctrl+r` or `/rename [name]` — rename the current live session |

`plan-mode/`'s `ctrl+p` plan-workflow shortcut and `extension-toggle/`'s `ctrl+e` picker shortcut both
collide with core defaults, so `keybindings.json` frees those keys up:

- `app.model.cycleForward` (default `ctrl+p`) and `app.model.cycleBackward` (default `shift+ctrl+p`)
  are cleared (`[]`) — model cycling is dropped in favor of plan-mode access cycling on `ctrl+p`.
- `app.model.select` (default `ctrl+l`) gets `ctrl+shift+p` added, so the freed-up `ctrl+shift+p` opens
  the model selector (same UI as `/model`) instead of cycling models.
- `tui.editor.cursorLineEnd` (default `["end", "ctrl+e"]`) drops the `ctrl+e` alias, keeping only `end`,
  so `extension-toggle/`'s `ctrl+e` picker shortcut doesn't collide with moving the cursor to line end.

## Packages (`agent/settings.json` → `packages`, npm-managed)

Installed via `pi install npm:<name>` (writes here automatically; `pi update --extensions` reconciles):

| Package | Purpose |
|---|---|
| `@dreki-gg/pi-lsp` | Generic LSP integration — one `lsp` tool with 11 operations (diagnostics, hover, go-to-definition, references, symbols, call hierarchy, code actions). Config-driven; all servers **disabled by default** — enable per-project in `.pi/lsp.json` or globally in `agent/extensions/lsp/config.json` |
| `pi-ast-grep` | Generic AST search — one `ast_grep` tool wrapping the `ast-grep` CLI (`run`/`scan`). **Read-only in v0**, no rewrite mode. For structural rewrites, invoke the `ast-grep` CLI directly via `bash` (`ast-grep run -p '<pattern>' -r '<rewrite>' -U`) |


Installed package sources live under `agent/npm/node_modules/` (gitignored — see `agent/npm/.gitignore`
and the repo-root `.gitignore` entry for `agent/extensions/*/node_modules`).

## Agents & Prompts

`agent/agents/*.md` and `agent/prompts/*.md` back the `subagent` extension:

- **Agents** (user-level, always loaded): `scout` (fast recon, OpenCode GPT-5.6 Luna), `planner` (implementation plans, OpenCode GPT-5.6 Luna), `reviewer` (code review, OpenCode GPT-5.6 Terra), `researcher` (primary-source cited briefs with compact handoffs, OpenCode GPT-5.6 Terra), `worker` (bounded implementation, OpenCode GPT-5.6 Terra, full tools).
- **Prompts** (workflow presets): `/implement` (scout → planner → worker), `/scout-and-plan` (scout → planner), `/implement-and-review` (worker → reviewer → worker).

Project-local `.pi/agents/*.md` only load if a subagent call passes `agentScope: "both"` or `"project"`. The foreground-only runner projects throttled child state through Pi's default tool shell, bounds output and runtime, and uses mode-0600 temporary task files; see `extensions/subagent/README.md`.

**`heyhuynhgiabuu/pi-task` was evaluated and not vendored.** It adds background (non-blocking) tasks
with tmux/HerdR pane observability, restart-recovery, and durable resumable `conversation_id` subagent
threads — real capability `subagent/` doesn't have (foreground-only single/parallel/chain). Not vendored
because it would register a second, competing delegation tool (`task` alongside `subagent`) with no
integration into this repo's `agents/`/`prompts/` workflow-preset system. Revisit only if
background/async subagents with tmux pane observability become a real need.

## Skills (`agent/skills/`)

27 skills, migrated from three cloned skill repos and adapted for pi. Flat layout — one
`skills/<name>/SKILL.md` per skill, no source-grouping subfolders (discovery is recursive either
way, so this is purely organizational, matching the flat `extensions/` convention). Each skill is
self-contained per the [Agent Skills standard](https://agentskills.io/specification); some also
carry a `references/` subdir or other support files (scripts, templates) alongside `SKILL.md`.

### Adaptation conventions applied during migration

None of the source repos targeted pi, so every skill was swept for harness-specific mechanics
before landing here:

- **Cross-skill references are prose, not slash commands.** `/tdd`, `/code-review`, etc. in a
  skill's body were rewritten to "the tdd skill", "the code-review skill" — pi's `/skill:name`
  commands are parsed from typed user input, not reliably invocable from the model's own
  generated text, so a literal slash-command cross-reference would silently do nothing. Where a
  skill's text describes what a *user* types (e.g. `/skill:triage`), the real pi command syntax
  is used instead.
- **Agent-delegation mechanics map onto the `subagent` tool.** Claude/Codex-specific "Agent
  tool", "Task tool", `subagent_type=Explore`, and "general-purpose subagent" became the
  `subagent` tool's single/parallel modes, using the `scout` agent for read-only recon and the
  `worker` agent for anything that writes.
- **Frontmatter trimmed to what pi recognizes.** `argument-hint` (a Claude-only field) was
  dropped; `disable-model-invocation` was kept as-is (pi implements it identically — hides the
  skill from the system prompt, reachable only via `/skill:name`); `allowed-tools` was kept where
  present, translated to pi's tool names (`Bash`→`bash`, `Read`→`read`, `Grep`→`grep`,
  `Glob`→`find`).
- **Repo-bootstrap dependencies on skills that weren't migrated were inlined.** Several
  engineering skills assumed a `setup-matt-pocock-skills` skill (excluded from migration) had
  already configured the project's issue tracker / triage labels; those now ask the user directly
  and once, with a suggestion to save the answer to `docs/agents/issue-tracker.md`, instead of
  pointing at a command that doesn't exist here.
- **Claude Code-only artifacts were generalized or dropped.** `index-knowledge` now targets
  `AGENTS.md` (this repo's own canonical convention) instead of `CLAUDE.md`, while still detecting
  either. `cx-handoff`/`tldr` no longer read the `~/.config/smap/` session-map log — smap is a
  Claude-only convention (written by Claude's own `smap-update` skill), disregarded entirely on the
  pi side rather than treated as an optional input. `tldr` also drops the Claude-specific
  `.claude/worktrees/` path special case (no pi equivalent). `skill-rules.json` (Claude Code's
  keyword/regex activation config) was not migrated — pi decides skill loading from `description`
  alone.

### Migrated skills

| Skill | Source | Purpose |
|---|---|---|
| `batch-commit` | claude/skills | Split work into scoped commits, group into PR-sized batches, Conventional Commits. Never pushes. |
| `cc-clipboard` | claude/skills | Pipe file/command-output/search-result content to the clipboard via `pbcopy`. |
| `cx-handoff` | claude/skills | Paste-ready handoff prompt to the clipboard; `--review`/`--continue` modes. |
| `index-knowledge` | claude/skills | Generate a hierarchical `AGENTS.md` knowledge base (root + scored subdirs). |
| `tldr` | claude/skills | Ultra-short "where was I" project orientation: goal, worktrees, todos, PR state. |
| `code-review` | mattpocock-skills/engineering | Two-axis (Standards + Spec) review of a diff, run as parallel sub-agents. |
| `codebase-design` | mattpocock-skills/engineering | Vocabulary + principles for designing deep modules (module, interface, seam, adapter). |
| `diagnosing-bugs` | mattpocock-skills/engineering | Disciplined reproduce → minimise → hypothesise → instrument → fix loop for hard bugs. |
| `domain-modeling` | mattpocock-skills/engineering | Actively build/sharpen a project's domain model; maintains `CONTEXT.md` + ADRs. |
| `grill-with-docs` | mattpocock-skills/engineering | A grilling session that also builds the domain model as it goes. |
| `implement` | mattpocock-skills/engineering | Build the work described by a spec/tickets, driving `tdd`, closing with `code-review`. |
| `improve-codebase-architecture` | mattpocock-skills/engineering | Scan for deepening opportunities, present as an HTML report, grill through the pick. |
| `prototype` | mattpocock-skills/engineering | Throwaway prototype (terminal app for logic, or UI variations) to answer a design question. |
| `research` | mattpocock-skills/engineering | Investigate against primary sources, capture cited findings as a Markdown file. |
| `resolving-merge-conflicts` | mattpocock-skills/engineering | Work an in-progress merge/rebase conflict hunk by hunk by intent; never `--abort`. |
| `tdd` | mattpocock-skills/engineering | Red-green-refactor loop; what a good test is, seams, anti-patterns. |
| `to-spec` | mattpocock-skills/engineering | Synthesize the current conversation into a spec/PRD, publish to the issue tracker. |
| `to-tickets` | mattpocock-skills/engineering | Break a plan/spec into blocking-edge-declared tracer-bullet tickets. |
| `triage` | mattpocock-skills/engineering | Move issues/PRs through a triage-role state machine; writes agent-ready briefs. |
| `wayfinder` | mattpocock-skills/engineering | Plan oversized work as a shared map of decision tickets, resolved one at a time. |
| `grill-me` | mattpocock-skills/productivity | User-invoked entry point into the `grilling` skill. |
| `grilling` | mattpocock-skills/productivity | Relentless one-question-at-a-time interview to resolve a decision tree. |
| `handoff` | mattpocock-skills/productivity | Compact the current conversation into a handoff document for another agent. |
| `teach` | mattpocock-skills/productivity | Teach the user a topic over multiple sessions using the cwd as a stateful workspace. |
| `writing-great-skills` | mattpocock-skills/productivity | Reference for writing/editing skills well — the vocabulary behind predictable skills. |
| `last-20-percent` | juliusbrusse-skills | Finds and finishes the experiential last 20% of a build (the magic moment, golden artifacts). |
| `terminate-slop` | juliusbrusse-skills (renamed from `fuck-slop`, de-vulgarized) | Detects and erases AI-writing tells; rewrites text into its target register. |

Project-local `.pi/skills/` or `.agents/skills/` (if a project adds either) layer on top of these
user-level skills — no interplay to note beyond pi's normal name-collision-keeps-first-found rule.

Not migrated, and out of scope unless separately requested: `claude/skills/{code-review, diff-summary,
plan-review, smap-backfill, smap-read, smap-review, smap-summarize, smap-update, skill-rules.json}`,
`mattpocock-skills/skills/{engineering/ask-matt, engineering/setup-matt-pocock-skills, deprecated/,
in-progress/, misc/, personal/}`, `juliusbrusse-skills/skills/{caveman, context-canary, grill-me,
interface-kit, junior-to-senior, loop-factory}`.

## Web search/browse tooling

`web-tools/` (forked from `dmmulroy-config`) is installed. Two alternatives were evaluated and not chosen:

| Option | Pros | Cons |
|---|---|---|
| **`web-tools/` (chosen)** | Lightest — plain `webfetch`/`websearch`, no browser/daemon, private-host/SSRF guards built in | No JS rendering — pages that need JS to render content fetch incomplete markdown/text |
| Exa MCP + `pi-mcp-bridge` | Standard MCP protocol, reusable config across MCP clients, bridge itself is minimal/dependency-free | Extra process (MCP server + bridge), chattier tool schemas |
| `@ogulcancelik/pi-web-browse` | Real headless Chrome (CDP) — handles JS/Cloudflare, no per-query API cost, warm daemon | Heaviest option — needs a real browser install, background daemon + hidden profile, slower cold start |

### Fork changes from upstream `dmmulroy-config/home/.pi/agent/extensions/web-tools/`

Upstream's `websearch` called `https://m.mulroy.dev/m/e`, dmmulroy's personal Exa proxy. This fork
uses the official structured APIs instead and retains caller-owned credentials:

- Exa is the default provider: `POST https://api.exa.ai/search`, required `$EXA_API_KEY`, sent as
  `x-api-key`. The adapter sends structured `query` / `numResults` / `type` JSON and schema-checks
  the response; the old MCP JSON-RPC/SSE text parser is removed.
- Parallel is an explicitly selected provider (`WEB_TOOLS_SEARCH_PROVIDER=parallel`):
  `POST https://api.parallel.ai/v1/search`, optional `$PARALLEL_API_KEY` sent as a Bearer token.
  It maps `fast` to Parallel `fast`, and `auto`/`deep` to `advanced`; it never silently falls back
  from Exa.
- `settings.ts` separates fetch and search defaults, supports documented `WEB_TOOLS_*` endpoint and
  behavior overrides, and models provider configuration as a redacted discriminated union.
- `providers/http.ts` is the shared bounded JSON transport. Both providers cap responses at 1 MB and
  return normalized results. The extension still has no custom renderer: `tool-display/` owns the
  shared presentation.

The extension declares matching Pi/TypeBox peers plus local dev dependencies; run `npm install` and
`npm run check` in `extensions/web-tools/` after dependency changes. See its README and
`research/web-tools-provider-apis.md` for configuration and official API-source links.

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
