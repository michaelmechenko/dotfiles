# mm-sidebar

> Canonical reference for the `M-Tab` tmux sidebar. Cross-references:
> `AGENTS.md` "tmux sidebar" section, `KEYBINDS.md` "tmux — sidebar" section,
> `COLORS.md` "mm-sidebar integration" section. Session logs:
> `mm-sidebar-HANDOFF.md`.
>
> Renamed from `mega-michael-sidebar` in revision 3.

A leftmost, full-window-height tmux pane toggled by `M-Tab`, running a compiled
Go/Bubble Tea TUI. Renders a stack of vertical blocks: a 2-line header, a
flexible tab-switchable **navigator** (sessions / windows / filetree / scratch),
and fixed-height **docked blocks** below it (`agents_glance`, `system_stats`)
that stay visible regardless of which navigator tab is active.

Inspired by [neo-tree.nvim](https://github.com/nvim-neo-tree/neo-tree.nvim)
(in-tmux, not in-nvim), the agent-multiplexer overview of
[herdr](https://github.com/herdrdev/herdr), and the stacked
tree-plus-persistent-gauges layout of
[agent-manager](https://github.com/YoanWai/agent-manager) — its session tree
sits above a fixed "computer" gauge block that never scrolls out of view, the
direct inspiration for the docked-blocks layout here. Not built on
[tabby](https://github.com/brendandebeasi/tabby), whose sidebar is a fixed
window-list with appended widgets rather than switchable sources.

## Layout

```
┌────────────────────────────────────┐
│ 1sess 2win 3tree 4scr              │  header: tab strip (active chip = canvas on lavender)
│ ▸ sessions                         │  header: active-tab subtitle
│ ▶ float          2w   ●            │  navigator — flexible, owns the cursor and Enter
│     ~/.config                      │  two-line rows: identity, then cwd
│   m*             6w                │
│     ~/_main/product-enablement      │
│   misc           1w                │
│     ~/_main/tulip                  │
│                                    │  slack collects here, as one gap
│ ────────────────────────────────── │  divider (divider-subtle)
│ ▸ agents                           │  docked block — read-only glance
│   !P r-notes · m*                  │
│   !W n8n-salesforce · m*           │
│   ~~ conf · float                  │
│      nvim · m*                     │
│   +1 more                          │
│ ────────────────────────────────── │
│ ▸ system                           │  docked block — read-only glance
│ cpu  ▓▓▓▓▓▓▓▓▓▓▓░░░░░░░░░ 58%      │
│ mem  ▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓░░░░ 83%      │
│ disk ▓▓▓▓▓▓▓▓▓░░░░░░░░░░░ 48%      │
│ batt ▓░░░░░░░░░░░░░░░░░░░ 5%       │
└────────────────────────────────────┘
```

The pane is **36 columns** wide (`TMUX_SIDEBAR_WIDTH`, default in
`tmux-sidebar-toggle` and `tmux-sidebar-repin` — change both together). It was 28
through revision 3; the density pass widened it.

`View()` emits **exactly `pane_height` lines**, every frame, at every size.
Verified live at four heights (all blocks fit / `system_stats` dropped / both
dropped / two-line rows clipped to a viewport) with `capture-pane | wc -l`
matching `#{pane_height}` each time.

## Components

| Path | Role |
| --- | --- |
| `tmux_scripts/mm-sidebar/` | The Go module. `go.mod`/`go.sum` tracked; binary gitignored. |
| `tmux_scripts/tmux-sidebar-toggle` | `M-Tab` / `prefix Tab` entry point. Three-state focus toggle + pane lifecycle. |
| `tmux_scripts/tmux-sidebar-build` | Builds the binary on demand; prints its path, or exits 1 so callers can fall back. |
| `tmux_scripts/tmux-sidebar-repin` | Restores every sidebar pane to its configured width after a resize. |
| `tmux_scripts/tmux-agent-ls` | Thin wrapper over `mm-sidebar agents` (the only copy of the join). |
| `tmux_scripts/tmux-sidebar` | **Legacy bash dispatcher**, retained only as the no-Go-toolchain fallback. |

### Go module layout

| Package | Responsibility |
| --- | --- |
| `main.go` | Entry point; `mm-sidebar` (TUI) and `mm-sidebar agents` (TSV) subcommands. |
| `model.go` | Bubble Tea model: layout + degradation, keys, mouse, the agent feed, fsnotify. |
| `internal/tmuxio` | **The only place that talks to tmux.** One batched `display-message -p` per tick. |
| `internal/theme` | Resolves the `@color-*` palette into `lipgloss` styles. |
| `internal/agents` | The Claude + pi pane join. |
| `internal/nav` | The 4 navigator tabs and their `Enter` actions. |
| `internal/blocks` | The `Block` interface and the two docked blocks. |

## State (window-scoped tmux user options)

All state is `setw -w` (window-scoped) so each window remembers its own tab and
sidebar presence — mirroring neo-tree's per-tab isolation.

| Option | Meaning |
| --- | --- |
| `@sidebar_pane_id` | The sidebar pane. Unset when closed. |
| `@sidebar_content_pane` | The pane the sidebar navigates/opens into. Retargeted to whichever pane you `M-Tab` *from*. |
| `@sidebar_source` | Active tab (`sessions`\|`windows`\|`filetree`\|`scratch`). **Deliberately not cleared on close**, so re-opening restores your tab. |

Per-pane marker: `@sidebar_pane 1` + pane title `sidebar`, so `tsave` and border
coloring can detect it.

`internal/tmuxio` reads all of these through `#{@user_option}` inside the single
per-tick `display-message -p` — that format resolves window-scoped options with
normal option-scope fallback and yields an empty field when unset (verified
live), so no separate `show-options` forks are needed.

### Content-pane tracking

`@sidebar_content_pane` is verified every refresh. If the recorded pane is dead,
it is recomputed as "the pane immediately right of the sidebar by `pane_left`
geometry" (the sidebar is always leftmost and full height, so that is the content
area by construction) and re-stored — the neo-tree "don't lose track of the
target window" guarantee.

`ftRoot` (the filetree's browse root) is only re-derived from the content pane's
cwd when the content pane actually **changes** (tracked via `ftLastPane`), never
on every refresh — otherwise `Backspace`-navigate-up would be silently reset on
the next 2s poll.

## `M-Tab`: three-state focus toggle

| State | `M-Tab` / `prefix Tab` |
| --- | --- |
| no sidebar in this window | open + focus the sidebar |
| open, focus in content | retarget `@sidebar_content_pane` at this pane, focus the sidebar |
| open, focus in sidebar | focus the content pane — **sidebar stays open** |

Closing is `q`/`Esc` inside the sidebar, or `tmux-sidebar-toggle --close`
(unbound; for scripts).

**Why focus-toggle rather than open/kill.** The old behavior killed the pane on
the second press, so every "peek at the tree and go back" cycle paid a full
process respawn. That respawn cost was also the entire justification for the old
stash-via-`break-pane` follow-up (tabby's trick: `break-pane -d` into a hidden
holding session so the renderer keeps running), which needed an AeroSpace
exclusion for the holding session's window and was never solved. Not killing the
pane retires that follow-up rather than working around it.

Implementation notes:

- **Atomic `mkdir` lock with a pid staleness guard**, the same idiom as
  `sketchybar/plugins/frontapps.sh`. `run-shell` is asynchronous, so a fast
  double-press can start two invocations before either writes
  `@sidebar_pane_id`; both would take the open path. The `kill -0` guard clears a
  lock left by a killed run, so a stale lock can never permanently break `M-Tab`
  — the failure mode the `@in_float_popup` flag hit (see `AGENTS.md`).
  Verified: two concurrent invocations produce exactly one sidebar.
- **The acting pane comes from `$TMUX_PANE`, not `display-message -p
  '#{pane_id}'`.** The latter resolves to the *currently active* pane per the
  attached client, which is not necessarily the pane an invocation belongs to —
  the same trap documented for `nnn/plugins/.nnn-preview-scroll`. tmux exports
  `TMUX_PANE` to `run-shell` with the target pane.
- **Deterministic focus on close.** Both the `q` path (in the binary) and
  `--close` read `@sidebar_content_pane` *before* clearing the options and
  `select-pane` it, so focus after a close is never "whatever pane tmux picked".

### Reachability

Three pieces must stay aligned for `M-Tab`:

1. **Ghostty** (`ghostty/config`): `keybind = alt+tab=csi:9;3u` — Tab is keycode
   9, Alt is modifier 3. Same recipe as the existing `alt+enter=csi:13;3u`.
2. **tmux**: `extended-keys on` + `extended-keys-format csi-u` (already set).
3. **tmux bind**: guarded with
   `#{||:#{popup_width},#{==:#{session_name},nnn}}` so `M-Tab` forwards raw
   inside any popup or the `nnn` session, matching the `M-j`/`M-q` pattern.

**`prefix Tab` is bound to the same script as a terminal-agnostic fallback.**
`M-Tab` exists only because of (1); from another emulator, or over SSH from a
machine without that mapping, it silently does nothing. `prefix Tab` needs no
terminal cooperation, so the sidebar is never unreachable. It is the same three
states, not a second behavior.

### Width re-pinning (and why the obvious version doesn't work)

tmux scales panes **proportionally** on client/window resize, so a Ghostty resize
or a monitor attach drifts the 36-col sidebar. Measured: shrinking a window from
160 to 100 columns collapsed the sidebar to **1 column**.

`client-resized[100]` and `window-layout-changed[100]` both call
`tmux-sidebar-repin`. Four things matter, all established by testing:

- **It must be deferred (`run-shell -b`), not an inline `resize-pane`.** A resize
  issued synchronously inside those hooks is discarded — tmux applies its own
  proportional layout *after* the hook body returns. Confirmed live: the inline
  hook fired with the correct pane id every time and the width still ended up
  at 1.
- **The script sweeps every window.** `client-resized` resolves formats against
  the client's current window only, so an inline `#{@sidebar_pane_id}` would
  re-pin just the window you happen to be looking at.
- **The `[100]` index is required.** `window-layout-changed` and
  `after-resize-pane` already carry `refresh-active-bg` at index `[0]`; an
  unindexed `set-hook -g <name>` overwrites index 0 and would silently delete the
  active-pane background switching. (Verified both indices coexist afterward.)
- **The "already correct" check is the recursion brake.** The script's own
  `resize-pane` re-fires `window-layout-changed`; the next invocation sees the
  width already matching and does nothing.

> **Gotcha:** `show-hooks -g` with no argument does **not** list
> `window-layout-changed` at all, so it looks unset. Query it by name
> (`show-hooks -g window-layout-changed`) to see both indices. The hook does
> fire — verified by instrumenting it with a `run-shell` that touched a file.

## Blocks architecture

The pane renders top to bottom: **header** (2 lines) → optional **help overlay**
(6 lines, `?`) → **navigator** (flexible) → **docked blocks** (fixed height, in
order).

```go
type Block interface {
    ID() string
    Interval() time.Duration   // its own cadence, not a shared dirty flag
    Fetch() tea.Cmd            // expensive; runs off the input path
    Update(tea.Msg)            // absorbs its own message type
    Height() int               // from cached state; never fetches
    View(width int) string     // exactly Height() lines
}
```

Blocks are listed in one ordered slice in `newModel()`. **Adding a block is one
type plus one slice entry** — no layout code changes. (The bash version needed a
hand-written case statement in three separate dispatch functions, because macOS's
`/bin/bash` 3.2 has neither associative arrays nor namerefs to look up
`fetch_$id`. An interface makes that workaround moot.)

Each block carries a full-width `─` divider row above it (`divider-subtle`) plus
the header's `▸ <name>` subtitle idiom as its own label row. The label alone was
doing the divider's job through revision 3, which made header / navigator /
agents / system read as one undifferentiated column.

### Layout + degradation

A **proportional split**, not shrink-to-content and not bottom-pinned:

1. `usable = pane_height - header_lines` (2, or 8 with the help overlay open).
2. `navFloor = usable * 6/10`, at least `navMinHeight` (3). This is the
   navigator's guaranteed minimum share.
3. Sum every active block's `Height() + 1` (the `+1` is its divider row). If that
   exceeds `usable - navFloor`, drop the **last** block in the slice — lowest
   degradation priority, `system_stats` before `agents_glance` — and recompute.
   Repeat until they fit or no blocks remain.
4. The navigator gets **all** the remaining space, i.e. `usable - dock_total`.
   That puts the last block's final row flush with the bottom of the pane and
   leaves the empty space as one contiguous gap inside the navigator, rather than
   splitting it between a gap above the blocks and dead rows below them.

Step 2 is the fix for revision 3's dominant visual defect: the navigator got
*all* leftover space with no floor and no ceiling, so a 3-row session list on a
45-row pane left a ~30-row void between the last row and `▸ agents`.

Rows are **variable-height** (sessions/windows are two lines, filetree/scratch
one), so the viewport scrolls in whole-row units while being measured in lines,
and `navLines` records a rendered-line → row-index table (`m.lineRow`) for the
mouse handler. Deriving the row from the click's `Y` offset arithmetically only
worked while every row was exactly one line tall.

### Docked block: `agents_glance`

Read-only, always visible. Capped to 6 rows, **sorted by urgency** (stable, so
rows don't shuffle between sweeps) with a trailing `+N more` when clipped. No
cursor, no `Enter` — interactive agent switching stays on the existing `M-b`
menu (`tmux-claude-menu`), which already covers it. This is also why `agents` is
not a navigator tab: the picker-vs-glance split removes a genuinely redundant
interactive surface.

Row format: `<2-char state tag> <window · session>`.

| Tag | State | Color role |
| --- | --- | --- |
| `!P` | awaiting-permission | `accent-primary` rose |
| `!W` | waiting | `accent-primary` rose |
| `~~` | thinking | `accent-tertiary` dusty pink |
| (blank) | idle | `text-muted` |

Two deliberate choices, both forced by the narrow column budget (28 at the time;
the reasoning still holds at 36):

- **The tag column is fixed width.** The words it replaced (`!perm`, `!wait`,
  `…`, a bare space) were 5, 5, 1 and 1 cells wide, so no two rows started their
  location in the same column and the block was unscannable.
- **There is no `[claude]`/`[pi]` suffix.** It cost 8 of 28 columns and was the
  least actionable field — and it spent them on the urgent rows, where the
  *location* (the thing you act on) got truncated instead. A pi pane's window is
  already auto-named `node`, which reads as pi in practice. State stays
  double-encoded as color, not tag alone.

Colors are the same three roles `tmux-claude-menu --colorize` uses, so the `M-b`
menu and this glance encode state identically.

### Docked block: `system_stats`

Read-only cpu/mem/disk/battery, on its own 5s cadence (machine load doesn't need
per-keystroke freshness, and the `ps -eo pcpu` sample is the priciest recurring
call). Reuses commands already trusted in this repo rather than inventing a
measurement approach: core-count-normalized `ps -eo pcpu` per
`sketchybar/plugins/cpu.sh`, `pmset -g batt` per `battery.sh`, plus
`vm_stat`/`hw.memsize` for memory (approximate by design). Battery renders only
when a percentage is reported, so a desktop shows no misleading `0%`.

**Disk measures `/System/Volumes/Data`, not `/`.** On a modern macOS install `/`
is the sealed read-only system volume, so `df /` is not a "disk full" gauge —
measured on this machine `/` reports **5%** while the data volume reports
**48%**. The bash version used `df -H /` and therefore showed 5%, which is not a
rounding difference from the truth. Falls back to `/` if the path is absent.

Each metric renders as a **20-cell block bar** — `▓` fill in `accent-secondary`
(or `accent-primary` rose when hot: cpu/mem/disk ≥ 85%, battery ≤ 20%), `░` track
in `divider-subtle`, then the numeric percent. This is the gauge half of
agent-manager's "computer" panel that revision 3 rendered as bare text. Bar width
is a fixed constant rather than width-reactive; `clip` handles a narrower pane.

**A nonzero reading floors at one filled cell.** At 20 cells anything under 5%
divides to an all-track bar indistinguishable from 0% — and it would also drop
the hot/low color entirely, which is exactly backwards for a 4% battery.

## Navigator tabs

| Tab | Data source | `Enter` action | Extra keys |
| --- | --- | --- | --- |
| sessions | `tmux-fzf-nav --list-sessions` | `switch-client` + `select-pane` | — |
| windows | `tmux-fzf-nav --list-windows` | `switch-client` + `select-pane` | — |
| filetree | `os.ReadDir`, 2 levels, over the content pane's cwd | dir → `split-window -h -c <dir>` in the content pane; file → `tmux-open-target` | `Backspace` = up one level |
| scratch | `~/.config/tmux_scratch/{global,<slug>}.md` | `tea.ExecProcess(nvim)` | — |

### sessions / windows

Reusing `tmux-fzf-nav` is what keeps the sidebar's session order identical to the
`M-w`/`M-s` pickers: **float first, then creation order**, a repo-wide invariant.

Rows render as **two lines**: identity on the first, cwd on the second.

```
▶ float          2w   ●        session name (accent when it's this session),
    ~/.config                  window count, ● when attached; cwd below

▶ 2:conf         nvim          window index:name, foreground command
    ~/.config                  cwd below
```

Four columns never fit one narrow line. `tmux-fzf-nav`'s field-3 *display* column
is space-padded to align columns in a wide fzf popup; through revision 3 the
sidebar rendered it verbatim and got `float    2:conf          …` with the cwd
truncated away entirely. `squeezeSpaces` fixed the *padding* but not the
over-subscription — the cwd, which is what distinguishes two same-named sessions,
was still the field that lost.

So **`tmux-fzf-nav` now also emits the same data unpadded, as fields 4+**, and the
sidebar formats its own rows from those:

| Mode | Fields 4+ |
| --- | --- |
| `--list-sessions` | `sname`, `windows`, `attached`, `cwd`, `current` |
| `--list-windows` | `win:name`, `cmd`, `cwd`, `active` |

Fields 1–3 are unchanged, which is why the fzf pickers are unaffected: they show
only field 3 (`--with-nth=3`) and `cut` fields 1–2. `squeezeSpaces` survives as
the fallback for a script that predates the extra fields. The **ordering** — the
part that must stay consistent across every surface in this repo — is untouched;
that is still entirely the script's.

> Watch the quoting when editing those awk programs: they are single-quoted shell
> strings, so an apostrophe in an awk comment terminates the program and bash
> reports a syntax error on a line you didn't touch.

cwd lines **truncate from the left** (`…config/tmux_scripts/mm-sidebar`), keeping
the tail. A path is most identifying at its end; right-truncation cuts off exactly
the part that distinguishes it from its siblings.

### filetree

Every row carries its real absolute path straight from the directory read. There
is **no** glyph-stripping or path reconstruction from a decorated display string.
An earlier `eza --tree --icons` version stripped tree glyphs to recover paths and
silently resolved every row to the tree root, so `Enter` on a nested directory
opened a pane in the wrong place. Verified live after the rewrite: `Enter` on a
nested row opens a pane at that exact path.

Directories before files at each level, second level indented 2 spaces,
directories in the lavender accent with a trailing `/`. Symlinks are classified
by their target, so a symlinked directory (this repo has several) still expands.

### scratch

- Global: `~/.config/tmux_scratch/global.md`
- Project: `~/.config/tmux_scratch/<slug>.md` (slug = path with both `/` and `.`
  replaced by `-`, matching `claude/projects/<slug>`)
- `~/.config/tmux_scratch/` is gitignored via `.git/info/exclude`.
- **Does not read `SMAP-TODOS.md`** — smap is Claude-only and pi disregards it;
  the scratch tab is a tool-agnostic buffer.
- Launched via `tea.ExecProcess`, which releases the terminal, runs nvim in the
  pane, and restores the TUI on exit. The bash version `exec`-replaced itself and
  re-exec'd the dispatcher; `ExecProcess` is the supported path and preserves the
  active tab. Verified end to end.
- Cosmetic: while nvim runs, `#{pane_current_command}` still reports
  `mm-sidebar` (nvim is a child, not the pane's foreground process group), so
  `automatic-rename-format` won't show `nvim`. Harmless.

## The agent join (`internal/agents`)

This is the performance story, and it is the reason the rewrite happened.

**The shell version cost 1.26–1.44s.** It forked `tmux-pi-session` once per pane,
and each probe forked `pgrep` + `ps` ×2 + `lsof` + `sed` + `ls` + `basename` — on
a 20-pane machine roughly a second of that was spent proving that panes are *not*
running pi. Worse, the bash dispatcher's key loop was a single blocking `read`,
so a keypress landing inside a sweep waited for the whole thing. Revision 2's
fetch/paint split fixed lag *between* polls; it never decoupled the poll.

**Steady-state cost now, per resolve:**

| Phase | Cost |
| --- | --- |
| `tmux list-panes -a` | 1 fork, ~13–15ms |
| Claude status | 0 forks — direct JSON reads |
| transcripts | 0 forks — cached |
| **total** | **~14ms** |

`ps -eww -o pid=,ppid=,args=` (1 fork, ~65ms) and the batched
`lsof -a -d cwd -Fn -p <csv>` (1 fork) run **only** when the pane-set fingerprint
changes or an agent identity isn't cached — i.e. when a pane or agent actually
appears or disappears. pi processes don't chdir, so pid→cwd is cached for the
process lifetime; pid→ppid likewise.

Measured with `MMS_TRACE=1` over ~9s: 5 resolves, **1** paid the `ps` sweep
(104ms cold), the other 4 were 13.6–15.7ms. Output is byte-identical to the shell
version, including a session with no discoverable transcript and one in each of
the four states.

**Use `MMS_TRACE=1` before theorizing about a slow sweep.** It logs per-phase
timings to stderr. It exists because a 1.3s outlier appeared in 8 runs (and once,
on a heavily loaded machine, an unreproducible 62s) — the sweep being off the
input path means an outlier costs freshness, never responsiveness, but "which of
tmux / ps / lsof stalled" should be an observation, not a guess.

### Recipes (ported, not redesigned)

- **Claude:** a `claude` process's **ppid is its owning pane's `pane_pid`**. cwd
  is *not* a usable key (many sessions share one cwd). Live status comes from
  `claude/sessions/<pid>.json`; `awaiting-permission` comes from the
  Notification-hook state file `/tmp/claude-session-state/<sessionId>`, the only
  signal distinguishing a permission prompt from an ordinary question.
  Transcripts are located **by sessionId**, not by deriving the slug from a cwd —
  `projects/<slug>` collapses `/`, `.` **and** `_` all to `-`, so the mapping
  isn't reversible across path types.
- **pi:** a pane whose direct child is pi (`comm == pi`, or Node running
  `*/pi-coding-agent/dist/cli.js`) → that process's cwd → pi's
  `--<cwd sans leading slash, remaining slashes as dashes>--` session directory
  (dots stay literal) → the newest `*.jsonl` there.

**fsnotify** watches `claude/sessions/` and `/tmp/claude-session-state/`, so
Claude state changes push rather than waiting for the next tick. pi has no
equivalent file, which is why the periodic tick remains the backstop.

**One deliberate behavior fix:** pi state was `idle` only when
`pane_current_command == "pi"`, but pi is a Node CLI whose `comm` is `node` on
releases that don't set their process name — which is also why a pi pane's tmux
window auto-names itself `node`. Every such pane therefore reported a permanent
`thinking`. The comparison is now against the resolved pi process's own argv[0]
basename, which is what the recipe intended.

### The 9-field TSV schema

`mm-sidebar agents` emits, tab-separated:

```
sessionId  pane_id  target  session_name  state  name  transcript  window_name  agent
```

`agent` ∈ `claude` | `pi`; `state` ∈ `awaiting-permission` | `waiting` |
`thinking` | `idle`.

**No field is ever emitted empty** — `-` is the placeholder. bash's `read` with
`IFS=$'\t'` collapses *consecutive* delimiters regardless of what IFS is set to
(tab is always "IFS whitespace" to bash's field splitter), so one genuinely empty
field shifts every later field left by one. That is exactly what produced the old
`[]` empty agent tag, with `wname`/`agent` silently swapped.

`tmux_scripts/tmux-agent-ls` is a **thin wrapper** over this. Its only fallback,
if the binary can't be built, is the Claude-only path it already contained
(`tmux-claude-ls` re-tagged through `awk`). pi rows are lost in that mode
deliberately: the alternative is a second copy of the pi recipe in shell, which
is the drift the wrapper exists to prevent. A missing pi row degrades a glance; a
stale duplicate recipe silently reports wrong state.

`tmux_scripts/tmux-claude-ls` keeps its own separate 9-field contract (ending in
`statusUpdatedAt`, not an agent tag) and its own callers (`M-b`, `M-G`,
`prefix .`) — untouched by this revision.

### Concurrency: the agent feed

The `Resolver` holds mutable caches (pane-set fingerprint, pid→cwd, pid→ppid,
transcript paths) and is **not** safe for concurrent use. Bubble Tea runs `Cmd`s
in separate goroutines, so a tick-driven fetch and an fsnotify-driven fetch would
otherwise enter it at the same time.

Every request funnels through one long-lived goroutine over a coalescing buffered
channel. That keeps the resolver single-threaded **and** keeps a slow sweep
entirely off the input path.

## Colors

See `COLORS.md`'s "mm-sidebar integration" section for the full table. The rule:
**no hex literals in the sidebar.** `internal/theme` resolves six `@color-*`
tmux options at startup; the hexes in that file are *fallbacks only*, for when
the binary runs outside a tmux server (`mm-sidebar agents` from a plain shell).

The active-tab chip sets fg and bg **explicitly** (canvas on lavender, bold) and
never uses reverse video — reverse swaps in whatever the terminal treats as its
default background, which reads as light gray. Same trap that made pi's moor
pager use `--statusbar=plain` instead of the default `inverse`. Explicit
canvas-on-accent also matches the documented lualine convention. `@color-canvas`
was added to `tmux.conf` for this.

`@color-divider` (`divider-subtle`, already defined in `tmux.conf`) is the sixth
option, added by the density pass for the block dividers and the unfilled gauge
track — both are background-weight surfaces, not text, so neither could reuse
`text-muted` without competing with the content in front of them.

## Keymap (sidebar pane focused)

| Key | Action |
| --- | --- |
| `1`–`4` | Switch to sessions / windows / filetree / scratch |
| `Tab` / `S-Tab` | Cycle tabs forward / back |
| `j` `k` / `↓` `↑` | Move cursor (navigator only, wraps) |
| `g` / `G` | First / last row |
| `Enter` | Act on the selected row (tab-specific) |
| `Backspace` | filetree: up one directory |
| `r` | Force refetch |
| `?` | Toggle help overlay |
| `q` / `Esc` | Close the sidebar |
| click | Select the clicked row |
| wheel | Move cursor |

Docked blocks have no keys — they're glances, not pickers.

Mouse works because tmux already has `mouse on` and Bubble Tea enables SGR
tracking (`WithMouseCellMotion`); clicks map back to a row through the current
viewport offset. Verified by injecting raw SGR sequences.

## Relationship to `M-d` and `M-b`

- The sidebar **filetree** is the quick-nav variant — no preview, just open.
  `M-d` (`tmux-nnn-explorer`) remains the full popup explorer with
  preview/moor/fzf/fzrg. They coexist; don't collapse them. The filetree reuses
  `tmux-open-target` for file opens, so the only real difference is the browsing
  UI.
- The **`agents_glance`** block is the quick-glance variant of agent status —
  read-only, always visible. `M-b` (`tmux-claude-menu`) remains the full
  interactive picker (focus, preview, accept-all). Don't fold `agents_glance`
  into a picker.

## Retired by the rewrite

These were real bugs in the bash dispatcher, fixed by moving off bash rather than
individually. Kept as history so nobody reintroduces the workarounds — **none of
this is current guidance**:

- **Enter was a no-op on every tab, two stacked root causes.** `read -rsn1`
  without `-d ''` stops early at a newline, so Enter read as an empty string
  (indistinguishable from the poll timeout); and even fixed, `k=$(read_key)`
  still ate it, because command substitution strips trailing newlines. Bubble Tea
  decodes keys.
- **tty-echo race under rapid keys.** `read -n` only suppresses echo *during*
  each call, so keystrokes leaked onto the screen between calls; worked around
  with a one-time `stty -echo -icanon`. Bubble Tea owns the termios state.
- **Off-by-one that scrolled the header off-screen.** Emitting exactly
  `pane_height` newline-terminated lines scrolled the terminal by 1 to advance
  past the last row, shifting the whole frame up every render; worked around by
  reserving a headroom row. Bubble Tea's renderer diffs frames and needs no
  headroom.
- **`trunc` measured characters, not display cells** (`${#plain}` on an
  ANSI-stripped copy), so nerd-font and CJK glyphs overflowed the frame and color
  was lost past the cut. Now `ansi.StringWidth`/`ansi.Truncate`; verified with a
  synthetic CJK tree that every rendered line stays within the pane width.
- **Fork storms in the fetch path.** `fg()` was a command substitution wrapping
  another command substitution, so every colored token cost 2 forks, plus a
  `basename` fork per filetree row — a ~200-row filetree was ~800 forks, re-run
  every 2s.
- **bash 3.2 empty-array crash.** Expanding an empty array with `"${arr[@]}"`
  under `set -u` throws on bash 3.2, which killed the dispatcher the first time
  the filetree hit a directory with no subdirs.
  **The premise was wrong, though:** the script was `#!/usr/bin/env bash`, which
  resolves to Homebrew bash **5.3.15**, not `/bin/bash` 3.2. Confirmed live — the
  crash only reproduces under `/bin/bash`. The doc previously claimed "this
  repo's default bash is 3.2"; it isn't, and bash 4+ features were being avoided
  for no reason.

## Build gotcha

`go get github.com/charmbracelet/x/ansi@latest` resolves **past** what
`lipgloss v1.1.0`'s pinned `x/cellbuf` expects and breaks the build with a wall
of `ansi.Style` signature errors. Pin `x/ansi v0.10.1`, and leave
`go-colorful v1.2.0` / `go-runewidth v0.0.16` alone. `bubbletea` resolves to
**v1.3.10** — the v1 `KeyMsg` API, not v2.

`tmux-sidebar-build` swallows compiler output so a broken tree can't break
`M-Tab`. Run `go build ./...` in the module directly to see errors.

## Follow-ups

1. **Retire the legacy bash dispatcher.** `tmux_scripts/tmux-sidebar` is now only
   the no-Go-toolchain fallback. Delete it once that fallback is judged
   unnecessary.
2. **Per-window vs. single global sidebar.** Still one process per window that
   toggles it. If process count ever matters, a single shared sidebar
   `join-pane`d into the current window is the alternative — bigger refactor,
   deferred.
3. **More dock blocks.** The `Block` interface is deliberately generic, so a
   git-status glance or a scratch preview is one type plus one slice entry. Append
   to the end of the slice for "drop first" degradation priority.
4. **`tload` doesn't re-open sidebars.** `tsave` now filters them out, so a
   restored window simply has no sidebar; press `M-Tab`. Auto-reopening would
   mean recording sidebar presence per window and replaying it.

## Stash-via-`break-pane`: closed, not deferred

Previous revisions carried this as follow-up #1: on close, `break-pane -d` the
sidebar into a hidden holding session so the renderer keeps running and re-open is
instant. It was deferred because the holding session's window gets tiled by
AeroSpace, needing an autohide/floating workspace or an AeroSpace exclusion.

**It is no longer wanted.** Its only purpose was hiding the respawn cost of
kill-on-close, and the three-state focus toggle means the sidebar isn't killed
incidentally in the first place. Don't reintroduce it.
