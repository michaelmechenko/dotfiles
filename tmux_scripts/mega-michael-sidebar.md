# mega-michael-sidebar

> Internal name for the neo-tree-like tmux sidebar plugin. The scripts live flat
> in `tmux_scripts/` (not a subdirectory) because the `M-Tab` bind and other
> `tmux_scripts/*` callers reference them by path; this doc is the canonical
> reference. Cross-references: `AGENTS.md` "tmux sidebar" section, `KEYBINDS.md`
> "tmux — sidebar" section.

A leftmost, full-window-height tmux pane toggled by `M-Tab`, running a
self-contained bash TUI dispatcher. Renders a stack of vertical blocks: a
2-line header, a flexible tab-switchable **navigator** (sessions / windows /
filetree / scratch), and fixed-height **docked blocks** below it
(agents-glance, system-stats) that stay visible regardless of which navigator
tab is active. Inspired by
[nvim-neo-tree/neo-tree.nvim](https://github.com/nvim-neo-tree/neo-tree.nvim)
(in-tmux, not in-nvim), the agent-multiplexer overview of
[herdr](https://github.com/herdrdev/herdr), and the stacked
tree-plus-persistent-gauges layout of
[agent-manager](https://github.com/YoanWai/agent-manager) (its session tree
sits above a fixed "computer" gauge block that never scrolls out of view —
the direct inspiration for this plugin's own docked-blocks layout). Not built
on [tabby](https://github.com/brendandebeasi/tabby) — tabby's sidebar is a
fixed window-list with appended widgets, not switchable sources. Borrowed one
idea from tabby: the stash-via-`break-pane` close path (not yet implemented;
see Follow-ups).

## Scripts

| Script | Role |
| --- | --- |
| `tmux-sidebar-toggle` | Pane lifecycle. Open = `split-window -h -f -b -l 28` (leftmost, 28 cols, **full window height** via `-f` regardless of how many other panes already exist on the content side) of the current pane, capture the new pane id via `-P -F '#{pane_id}'`, launch `tmux-sidebar` inside it. Close = `kill-pane` + clear window-scoped options. Idempotent: re-pressing `M-Tab` toggles. |
| `tmux-sidebar` | The dispatcher TUI. Renders header + navigator + docked blocks as raw 24-bit ANSI (same idiom as `tmux-claude-menu --colorize`), reads keys via a raw-mode `read -rsn1 -d ''` loop, dispatches to per-tab/per-block fetch/paint functions. Owns its key loop and a 2s re-poll timer. |
| `tmux-agent-ls` | The agents-glance gatherer. Wraps `tmux-claude-ls` (re-tagged to 9 fields ending in `claude`, see Gotchas) and adds pi rows. Schema-compatible with `tmux-claude-ls` so the sidebar and the `M-b` menu share the colorizer. |

## State (window-scoped tmux user options)

All state is `setw -w` (window-scoped) so each window remembers its own tab and
sidebar presence — mirroring neo-tree's per-tab isolation. Owned by
`tmux-sidebar-toggle`; read by `tmux-sidebar`.

| Option | Scope | Meaning |
| --- | --- | --- |
| `@sidebar_pane_id` | window | id of the sidebar pane (unset when closed) |
| `@sidebar_content_pane` | window | id of the pane the sidebar navigates/opens into |
| `@sidebar_source` | window | active navigator tab: `sessions` \| `windows` \| `filetree` \| `scratch` (default `sessions` on first open) |

Per-pane marker: `@sidebar_pane 1` + pane title `sidebar` on the sidebar pane,
so other scripts (`tsave`, `frontapps.sh`) can detect it.

## Blocks architecture

The pane renders top to bottom as: **header** (2 lines, fixed) → **navigator**
(flexible — gets whatever height is left) → **docked blocks** (fixed height,
in `SIDEBAR_DOCK_BLOCKS` order, defined near the top of `tmux-sidebar`).

```bash
SIDEBAR_DOCK_BLOCKS=(agents_glance system_stats)
```

This array is the whole "which blocks, in what order" configuration — reorder,
drop, or add a block by editing this one line plus its trio of functions. Each
block id `X` needs three functions dispatched by a case statement in
`dock_fetch`/`dock_paint`/`dock_height` (not dynamic function-name
construction via `eval`/namerefs — see Gotchas for why):

- `fetch_X` — expensive, populates the block's own cached state (subprocess
  spawns, tmux IPC).
- `paint_X` — cheap, prints from that cached state only (no subprocess spawns
  beyond what's already been fetched).
- `height_X` — cheap, returns the block's current desired row count (reads
  cached state, doesn't fetch) so the layout can reserve space and degrade
  gracefully on a short pane.

Each dock block reuses the same `▸ <name>` subtitle style as the header's
active-tab line as its own label/separator row — no extra blank divider lines
needed, since the label already visually delimits each block the same way the
header idiom already does.

### Layout + degradation (`render()`)

1. Compute `usable = pane_height - 1 (scroll headroom) - header_lines (2, or
   8 with the help overlay open)`.
2. Sum `height_X` for every block in `SIDEBAR_DOCK_BLOCKS`. If
   `usable - dock_total >= NAV_MIN_HEIGHT` (3), that's final.
3. Otherwise drop the **last** block in `SIDEBAR_DOCK_BLOCKS` (lowest
   degradation priority — `system_stats` before `agents_glance`) and
   recompute. Repeat until the navigator fits or no blocks remain.
4. Whatever's left after dock reservation goes to `paint_navigator`, which
   applies the pre-existing viewport-clipping/scrolling logic (see below) to
   that height.

Verified live in a real tmux pane at three sizes: everything fits (both dock
blocks + navigator), partial degrade (system_stats dropped, agents_glance
kept), full degrade (both dropped, navigator gets the whole pane).

### Dock block: `agents_glance`

Read-only, always visible regardless of the active navigator tab. Reuses
`tmux-agent-ls`'s fetch and the same state-based row coloring the old
`agents` tab used, but: capped to `AGENTS_GLANCE_MAX` (6) rows, **sorted by
urgency** (`awaiting-permission`/`waiting` first, `thinking` next, `idle`
last) so the rows that most need attention survive truncation, with a
trailing `+N more` row when clipped. **No cursor, no `Enter` handling** — this
block is a glance, not a picker. Interactive agent switching stays on the
existing `M-b` cross-session menu (`tmux-claude-menu`), which already covers
that need; `agents_glance` intentionally doesn't duplicate it. This is also
why `agents` was removed as a 5th navigator tab in this revision — the
picker-vs-glance split resolves a real redundancy the old 5-tab model had.

Fetch cadence: gated by the same `dirty` flag as the navigator (tab switch,
explicit `r`, the 2s poll timeout, filetree up-a-level) — agent liveness
wants roughly that same freshness, so no separate timer is needed here.

### Dock block: `system_stats`

Read-only cpu/mem/disk/battery glance — the piece of agent-manager's
"computer" panel this plugin actually adopted. Reuses commands already
trusted elsewhere in this repo rather than inventing a new measurement
approach: CPU% via the same `ps -eo pcpu` + core-count-normalized awk sum as
`sketchybar/plugins/cpu.sh`, battery via the same `pmset -g batt` parsing as
`sketchybar/plugins/battery.sh`, memory via `vm_stat`'s free+inactive page
counts against `sysctl hw.memsize` (approximate, not meant to byte-match
Activity Monitor), disk via `df -H /`'s Capacity column. **Not gated by
`dirty`** — refetches on its own independent `SYSTEM_STATS_REFRESH` (5s)
wall-clock timer, since machine load doesn't need per-keystroke or even
per-2s freshness, and the `ps` sample is the single priciest call in the
script. Fixed height (3: label + 2 stat lines).

## Navigator tabs

| Tab | Data source | `Enter` action | Extra keys |
| --- | --- | --- | --- |
| sessions | `tmux-fzf-nav --list-sessions` | `switch-client` + `select-pane` to that session's active pane | — |
| windows | `tmux-fzf-nav --list-windows` (current-session panes) | `switch-client` + `select-pane` to that pane | — |
| filetree | `find`-based 2-level tree over `@sidebar_content_pane`'s cwd (directories before files, each level indented) | dir → `split-window -h -c <dir> -t <content_pane>`; file → `tmux-open-target` (nvim split) | `Backspace` — navigate root up one level |
| scratch | `~/.config/tmux_scratch/{global,<slug>}.md` | `exec nvim <file>`; `:wq` returns to the dispatcher loop | — |

`agents` is **not** a navigator tab in this revision — see `agents_glance`
above for where it went and why.

### Filetree data model

Every row's path comes straight from `find -mindepth 1 -maxdepth 1`'s own
output (walked once for the root, once more per subdirectory for the second
level) — there is **no** glyph-stripping or path reconstruction from a
decorated display string. This replaced an earlier `eza --tree --icons`-based
approach whose glyph-stripping (`├── `, `└── `, `│   ` removal) was
approximate and always resolved every row's path to the tree root, silently
misrouting `Enter`-on-a-directory. Confirmed live: `Enter` on a nested
directory row now opens a new pane at that exact directory, not the root.

Directories are listed before files at each level (both `sort -z`'d), each
level indented 2 spaces, directories shown with a trailing `/` and in the
lavender accent color, files in the plain active-text color.

### Scratch buffers

- Global: `~/.config/tmux_scratch/global.md`
- Project: `~/.config/tmux_scratch/<slug>.md` (same slug scheme as
  `claude/projects/`)
- `~/.config/tmux_scratch/` is gitignored via `.git/info/exclude` (not
  `.gitignore`) — same convention as `SMAP-TODOS.md` / `tmux_sessions/`.
- **Does not read `SMAP-TODOS.md`** — smap is Claude-only and pi disregards it;
  the scratch tab is a fresh, tool-agnostic buffer.
- Launch pattern: `exec bash -c "nvim -- $qf; exec $qself"` — `:wq` exits nvim
  and re-execs the dispatcher fresh (the `tmux-pi-prompt` return pattern;
  `dirty` starts at 1 on a fresh process, so state re-fetches immediately).
  Verified live end-to-end.

## Agent row colorization (shared by `agents_glance`)

Same RGB triplets as `tmux-claude-menu --colorize`, keyed off `COLORS.md` roles:

| State | Color | Role |
| --- | --- | --- |
| awaiting-permission / waiting | `#d8647e` | `accent-primary` (rose) — `@color-rose` |
| thinking | `#bb9dbd` | `accent-tertiary` (dusty_pink) — `@color-dusty_pink` |
| idle | `#656a80` | `text-muted` — `@color-inactive` |

### pi detection (in `tmux-agent-ls`)

pi has no live pid-keyed session-state file (unlike Claude's
`claude/sessions/<pid>.json`). Rows are derived per-pane via the
`tmux-pi-last-response` recipe: a pane whose direct child process is `pi`
(`pgrep -P <pane_pid> -x pi`) → that process's cwd (`lsof -d cwd`) → pi's
`--<cwd without its leading slash; remaining slashes become dashes>--` session
directory (dots remain literal) → the newest `*.jsonl` there is the active session.
State is inferred: `idle` if `pi` is the pane's
foreground command, `thinking` otherwise. Less rigorous than Claude's
ppid-based join; good enough for the common case. Note pi's tmux window is
typically auto-named `node` (pi's own process `comm` is `node`, being a
Node.js CLI) — expected, not a bug, if you see `node · <session>` in a glance
row.

## Keymap (sidebar pane focused)

| Key | Action |
| --- | --- |
| `1` / `2` / `3` / `4` | Switch to sessions / windows / filetree / scratch |
| `Tab` / `S-Tab` | Cycle tabs forward / back |
| `j` / `↓` | Move cursor down (navigator only) |
| `k` / `↑` | Move cursor up (navigator only) |
| `Enter` | Act on the selected navigator row (tab-specific) |
| `r` | Force refetch + re-render |
| `?` | Toggle inline help overlay |
| `q` / `Esc` | Close the sidebar |

Docked blocks (`agents_glance`, `system_stats`) have no keys of their own —
they're glances, not pickers (see Blocks architecture above).

The `M-Tab` root bind is guarded with the `#{popup_width}` /
`#{==:#{session_name},nnn}` condition (same pattern as `M-j`/`M-q`) so `M-Tab`
forwards raw inside any popup or the `nnn` session.

## Reachability (`M-Tab` end-to-end)

`M-Tab` is not a stock reachable key. Three pieces must stay aligned:

1. **Ghostty** (`ghostty/config`): `keybind = alt+tab=csi:9;3u` — Tab is
   keycode 9, Alt modifier is 3, so CSI-u is `\x1b[9;3u`. Same recipe as the
   existing `alt+enter=csi:13;3u`.
2. **tmux** (`tmux.conf`): `set -g extended-keys on` + `set -g
   extended-keys-format csi-u` (already present, tmux 3.5+).
3. **tmux bind**: `bind-key -n M-Tab if -F '#{||:#{popup_width},#{==:#{session_name},nnn}}' { send-keys M-Tab } { run-shell "~/.config/tmux_scripts/tmux-sidebar-toggle" }`

Verified end-to-end: pressing Alt+Tab in a Ghostty+tmux pane shows the
`M-Tab reached tmux` diagnostic (step-1 reachability check). If `M-Tab` ever
stops reaching tmux, check (1) first (macOS doesn't grab Option+Tab by default,
unlike Cmd+Tab, but a Ghostty/OS update could change that).

## Dispatcher rendering details and gotchas hit live

- **ANSI, not tmux format strings.** The sidebar body is a pane, not a status
  line, so `#[fg=...]` format syntax doesn't apply. Emit raw 24-bit ANSI via
  `printf '\033[38;2;R;G;Bm...\033[0m'`. Palette hex is read once at startup
  from the `@color-*` user options (`tmux show -gqv @color-lavender2`, etc.).
- **`\033[H` (cursor home), not a full `\033[2J` clear, at the top of every
  render.** Each printed line ends in `\033[K` (clear-to-end-of-line, so a
  shorter line never leaves stray characters from a longer previous frame),
  and a trailing `\033[J` only fires if this frame has fewer total lines than
  the last one. Reduces flicker on cheap repaints (cursor moves) versus a
  full clear every frame.
- **Off-by-one that scrolled the header out of view.** Emitting exactly
  `pane_height` newline-terminated lines makes the terminal scroll by
  exactly 1 to advance the cursor past the last row — silently shifting the
  *entire frame* up by one line every render, permanently pushing the header
  above the visible viewport. Reproduced live (the tab strip was reliably
  missing from every capture until this was found). Fix: reserve 1 row of
  headroom (`usable = pane_height - 1 - header_lines`), so the cursor safely
  lands on the pane's actual last row instead of overflowing past it.
- **Fetch/paint split, gated by a `dirty` flag.** `fetch_navigator` (and
  `fetch_agents_glance`) only run when `dirty=1` — tab switch, explicit `r`,
  the 2s poll timeout, or a structural change (filetree up-a-level, scratch
  return). Plain cursor moves (`j`/`k`) and the help toggle only call
  `paint_navigator` from the cached `rows[]`/`actions[]`. Before this split,
  every keystroke re-ran the full data-gathering pipeline (multiple
  subprocess spawns + tmux IPC calls per source) — reproduced live as
  seconds-long lag on plain cursor movement in the `agents` tab (heaviest
  fetch: `tmux-agent-ls` loops every pane doing `pgrep`+`lsof`).
- **Viewport-clipped/scrolling navigator body.** `paint_navigator(avail)`
  only prints rows in a `[start, start+avail)` window that follows `sel`
  (centered, clamped to valid range), not the full `rows[]` array. Without
  this, a body with more rows than the space it's given (a large filetree is
  the common case) just scrolls the terminal on every render, which — before
  the off-by-one fix above was even isolated — was *how* the header-missing
  bug was first noticed.
- **Real Enter keypress was a complete no-op end to end, on every tab —
  two independent bugs, both reproduced and root-caused live:**
  1. `read -rsn1` (no `-d ''`) stops early at a newline by default (that's
     what `-n` is documented to do), so a real Enter keypress (`\n`) was
     read as an *empty* string — identical to the 2s poll timeout branch,
     silently no-oping Enter everywhere. Fixed by adding `-d ''` to every
     `read -n1` call, which disables that early-stop-at-newline behavior so
     a literal `\n` is captured instead of swallowed.
  2. Even after that fix, `k=$(read_key)` (command substitution) *still*
     ate it: command substitution unconditionally strips trailing newlines
     from captured stdout, so a `read_key` that correctly captured `\n` and
     `printf`'d it back out still came back empty once captured through
     `$(...)`. Root-caused with an isolated `bash -uc` harness reading a raw
     Enter keypress from a real pty. Fixed by having `read_key` set a global
     `KEY` variable directly instead of printing to stdout for capture —
     sidesteps the whole class of trailing-whitespace-swallowed bugs, not
     just this one instance.
  Confirmed fixed live end-to-end: `Enter` on a filetree directory row now
  opens a new pane at the exact selected path.
- **bash 3.2 (macOS's stock `/bin/bash`) throws "unbound variable" expanding
  an empty array with `"${arr[@]}"` under `set -u`** (fixed in bash 4.4+,
  but this repo's default bash is 3.2 — confirmed via `bash --version`).
  `"${!arr[@]}"` (indices) does **not** have this problem, only `"${arr[@]}"`
  (values) does. This crashed the dispatcher outright the first time the
  filetree hit a directory with zero subdirectories or zero files at depth 2
  — reproduced live (`line 257: d2[@]: unbound variable`, killing the pane).
  Every such value-expansion in `build_filetree_rows` is now guarded with
  `[ "${#arr[@]}" -gt 0 ]` first. The same constraint is why the dock-block
  dispatch uses a case statement instead of dynamic function names — bash
  3.2 also lacks associative arrays (bash 4.0+) and `local -n` namerefs
  (bash 4.3+), so a generic "look up `fetch_$blockid`" pattern isn't
  available without `eval`.
- **A real tty-echo race under rapid keys**, reproduced by sending 40 keys in
  a tight synthetic burst: `read -n` only suppresses terminal echo *during*
  each individual call, leaving a narrow window between consecutive reads
  where the tty's default echo can leak a raw keystroke onto the screen.
  Fixed by putting the tty into a stable `stty -echo -icanon min 1 time 0`
  mode once at dispatcher startup (restored on exit by `cleanup()`) instead
  of relying on bash's per-call termios save/restore.
- **2s re-poll timer** for the navigator/agents_glance: on timeout (empty
  key read), set `dirty=1` and loop back to render without consuming a key.
  Picks up agent state changes, new sessions, cwd changes in the content
  pane. Don't shorten below 1s or the render cost becomes visible; don't
  lengthen above 5s or agent states go stale.
- **`read -t` only works on a real tty.** In a tmux pane stdin is the pty, so
  the timeout holds. If you ever test the dispatcher from a non-pty shell,
  `read -t 2` returns immediately and the loop spins — always test inside a
  `tmux split-window`.
- **TSV field-collapse bug (fixed in both `tmux-claude-ls` and
  `tmux-agent-ls`).** bash's `read -r ... ` with `IFS=$'\t'` still collapses
  *consecutive* delimiters and trims leading/trailing ones — tab is always
  "IFS whitespace" to bash's field splitter regardless of what IFS is
  explicitly set to (that special-casing applies to space/tab/newline
  specifically, not to arbitrary single-character IFS values). A genuinely
  empty field (the common case: no discoverable transcript file) silently
  collapsed with its neighboring tab, shifting every later field left by
  one. Root-caused live: piping `tmux-agent-ls`'s real output through the
  exact same `read` line as `render_agents`/`fetch_agents_glance` showed
  `transcript` absorbing what should have been the `wname` field, `wname`
  absorbing what should have been `agent`, and `agent` ending up empty —
  reproducing the `[]` empty agent-type tag exactly. Fixed by never emitting
  a truly-empty field: both scripts substitute `"-"` for a missing
  transcript, matching the existing `name` field's own `"-"` placeholder
  convention (from `jq`'s `(.name // "-")`) rather than introducing a new
  approach.

## Content-pane tracking

`@sidebar_content_pane` is captured at open time (the pane that was focused when
`M-Tab` was pressed). On each render, `content_pane()` verifies it still exists
(`tmux display-message -p -t <id> '#{pane_id}'`); if dead, it recomputes as
"the pane immediately to the right of the sidebar by `pane_left` geometry" and
re-stores the option. This is the neo-tree "don't lose track of the target
window" guarantee — kill the content pane, open a new one, and the filetree /
scratch follow it. `ft_root` (the filetree's browse root) is only reset from
the content pane's cwd when the content pane actually *changes* (tracked via
`ft_last_cp`), not on every fetch — otherwise `Backspace`-navigate-up would
get silently reset back to the content pane's cwd on the next 2s poll.

## Interactions with existing scripts (verified)

- **`frontapps.sh` border coloring** — the sidebar pane gets the
  inactive/active-floating treatment like any other pane. Keys off pane title /
  command; the `sidebar` title doesn't mislead it.
- **`tmux-claude-open-split` / `M-G` placement** — splits "above the rightmost
  pane". With the sidebar on the left, the rightmost pane is still the content
  area, so placement is unaffected.
- **`refresh-active-bg` hook** — the sidebar adds a pane, so `#{window_panes}`
  flips 1→2 and the `refresh-active-bg` alias correctly switches to the 2+-pane
  active-bg branch. No flicker loop (the hook fires on `window-layout-changed`,
  which the split triggers once).

## Relationship to `M-d` (nnn popup) and `M-b` (Claude/pi menu)

The sidebar filetree is the **quick-nav** variant — no preview, just open.
`M-d` (`tmux-nnn-explorer`) remains the full popup file explorer with
preview/moor/fzf/fzrg. They coexist; don't collapse them. The sidebar filetree
reuses `tmux-open-target` for file opens (same nvim-split placement), so the
only real difference is the browsing UI (flat 2-level tree vs interactive nnn
with `;f`/`;g`).

The `agents_glance` dock block is the **quick-glance** variant of agent
status — read-only, always visible, no interaction. `M-b`
(`tmux-claude-menu`) remains the full interactive picker (focus, preview,
accept-all). They coexist; don't fold `agents_glance` into a picker.

## Follow-ups (not in this revision)

1. **Stash-via-`break-pane` instead of kill.** Tabby's trick: on close,
   `break-pane -d` the sidebar into a hidden holding session so the renderer
   keeps running and re-open is instant. Deferred because the holding session's
   window would get tiled by AeroSpace — needs an autohide/floating workspace
   or an AeroSpace exclusion. Start with kill (current); upgrade only if
   re-open latency is noticeable (dispatcher startup + first render).
2. **`tsave` sidebar-pane filter.** A sidebar pane would restore as a plain
   shell in its saved cwd, not re-launch the dispatcher. The `@sidebar_pane`
   marker is in place; add a filter to `tsave`'s pane walk (skip panes where
   `@sidebar_pane` is set), like tabby strips its utility panes from
   tmux-resurrect.
3. **Per-window vs. single global sidebar.** Still per-window (one dispatcher
   per window that toggles it). If process count matters with many windows,
   reconsider a single shared sidebar `join-pane`d into the current window —
   bigger refactor, defer.
4. **`COLORS.md` roles.** Still reuses existing `@color-*` options (no new
   hex). If a distinct sidebar bg or tab-active bg is wanted later, add a
   `sidebar-bg` / `tab-active` role to `COLORS.md` rather than inline hex (per
   the palette-discipline rule).
5. **More dock blocks.** The blocks architecture is intentionally generic
   (`SIDEBAR_DOCK_BLOCKS` array + fetch/paint/height trio per id) so a third
   block (e.g. a git-status glance, a scratch-buffer preview) is a small,
   additive change — no layout code needs touching, only degradation
   priority (append to the end of the array for "drop first").

## Files touched (this revision)

| File | Change |
| --- | --- |
| `tmux_scripts/tmux-sidebar-toggle` | `-f` full-height split flag |
| `tmux_scripts/tmux-sidebar` | blocks architecture rewrite: fetch/paint split with `dirty` gating, viewport-clipped navigator, docked `agents_glance`/`system_stats` blocks with degradation, Enter-key fix (×2 root causes), filetree rewritten on `find` (no path reconstruction), bash-3.2 empty-array guards, `stty` raw-mode hardening, off-by-one scroll fix, 4-tab navigator (agents moved to a dock block) |
| `tmux_scripts/tmux-agent-ls` | 9-field-consistent schema (statusUpdatedAt swapped for the `claude` tag rather than appended as a 10th field); empty-transcript placeholder |
| `tmux_scripts/tmux-claude-ls` | same empty-transcript placeholder fix |
| `tmux.conf` | `M-Tab` bind + guard (from the original MVP; unchanged this revision) |
| `ghostty/config` | `keybind = alt+tab=csi:9;3u` (from the original MVP; unchanged this revision) |
| `.git/info/exclude` | `tmux_scratch/` (from the original MVP; unchanged this revision) |
| `KEYBINDS.md` | tab-count/keymap update (4 tabs, not 5) |
| `AGENTS.md` | "tmux sidebar" source-of-truth section (from the original MVP; unchanged this revision) |
| `tmux_scripts/mega-michael-sidebar.md` | this file, rewritten for the blocks architecture |
| `tmux_scripts/mega-michael-sidebar-HANDOFF.md` | append-only session notes (see that file for this revision's entry) |
