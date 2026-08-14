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
│                                    │  unused space collects at the BOTTOM
│                                    │
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
| `tmux_scripts/tmux-sidebar-toggle` | `M-Tab` / `M-BTab` / `prefix Tab` / `prefix BTab` entry point. Open/close, focus switch, pane lifecycle. |
| `tmux_scripts/tmux-sidebar-build` | Builds the binary on demand; prints its path, or exits 1 so callers can fall back. |
| `tmux_scripts/tmux-sidebar-repin` | Restores every sidebar pane to its configured width after a resize. |
| `tmux_scripts/tmux-agent-ls` | Thin wrapper over `mm-sidebar agents` (the only copy of the join). |
| `tmux_scripts/tmux-sidebar` | **Legacy bash dispatcher**, retained only as the no-Go-toolchain fallback. |

### Go module layout

| Package | Responsibility |
| --- | --- |
| `main.go` | Entry point; `mm-sidebar` (TUI) and `mm-sidebar agents` (TSV) subcommands. |
| `model.go` | Bubble Tea model: state refresh, keys, mouse, `View`, the agent feed, fsnotify. |
| `layout.go` | The vertical arrangement: navigator/block sizing and block degradation. |
| `internal/tmuxio` | **The only place that talks to tmux.** One batched `display-message -p` per tick. |
| `internal/theme` | Resolves the `@color-*` palette into `lipgloss` styles. |
| `internal/agents` | The Claude + pi pane join. |
| `internal/nav` | The navigator tabs (`Source` registry) and their `Enter` actions. |
| `internal/blocks` | The `Block` interface, the `Factories` registry, and the docked blocks. |
| `internal/trace` | `MMS_TRACE=1` per-phase timing, shared by every package. |

Within `internal/nav`: `source.go` is the contract plus the `Sources` registry,
one file per source (`sessions.go`, `windows.go`, `filetree.go`, `scratch.go`),
`fzfnav.go` is what sessions and windows share, `act.go` performs a row's action.

## State (window-scoped tmux user options)

All state is `setw -w` (window-scoped) so each window remembers its own tab and
sidebar presence — mirroring neo-tree's per-tab isolation.

| Option | Meaning |
| --- | --- |
| `@sidebar_pane_id` | The sidebar pane. Unset when closed. |
| `@sidebar_content_pane` | The pane the sidebar navigates/opens into. Retargeted to whichever pane you `M-BTab` *from*. |
| `@sidebar_source` | Active tab — any `nav.Source`'s `ID()` (`sessions`\|`windows`\|`filetree`\|`scratch`). **Deliberately not cleared on close**, so re-opening restores your tab. An unrecognized value falls back to the first registered source. |
| `@sidebar_saved_layout` | The window's `window_layout` from just before the sidebar opened, replayed on close to undo the squeeze. Cleared on close, including when the replay is rejected as stale. |

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

### The poll is gated (revision 5)

Through revision 4 `refreshState` ran the active source's `Fetch()` on **every**
2s tick, unconditionally. On the sessions/panes tabs that shells `tmux-fzf-nav`,
which itself forks `display-message` + `list-sessions` + `list-panes` + `awk`:
roughly **8 processes every two seconds, forever**, whether or not anything had
changed. The agent join had a fingerprint discipline from day one; the navigator
— the thing running four times more often — never got one.

It now fetches only when `fetchKey` moves. The key is
`source id ⟂ content pane ⟂ filetree root ⟂ Snapshot.Fingerprint`, so a tab
switch and a `Backspace`-ascend invalidate it on their own and need no special
casing. An explicit `force` covers what the key cannot see: `r`, and returning
from the scratch editor (the file changed; no tmux state did).

`Snapshot.Fingerprint` rides along in the existing `Query()` fork, so the gate
costs nothing. **Two things about its format string are load-bearing:**

- **No trailing comma inside `#{W:…}`.** tmux loop formats take a second
  argument that is the format for the CURRENT session/window — it is *not* a
  separator. `#{W:>…,}` therefore renders each session's current window as the
  empty string, silently omitting exactly the window you are most likely to be
  changing. Measured: with the comma 5 of 7 windows appeared; without it, all 7.
  Verified live after the fix by renaming a session's *current* window and
  confirming it triggers exactly one refetch.
- **Separators must stay `:` / `;` / `>`.** A `.`-separated variant was tried and
  silently dropped a whole session.

Measured with `MMS_TRACE=1`: first poll `source-fetch:sessions 53.3ms`, then
`source-skipped 0.0ms` on every subsequent poll; `refresh-total` 83.6ms → ~27ms.
Creating a window produced exactly **one** refetch and then settled back to zero.

Two per-tick `display-message` forks also went away in the same pass:
`PaneAlive` and `PaneCurrentPath` are now answered from `tmuxio.PaneSet`, an
index over the single batched `ListPanes()` read ("alive" == "present in the
list"). Both functions were **deleted** rather than left unused, so the
fork-per-pane path can't quietly come back.

## `M-Tab` / `M-BTab`: two gestures, one script

One entry point, dispatched on argv: no argument is open/close, `--focus` is the
three-state focus switch, `--close` only ever closes.

| Key | State | Result |
| --- | --- | --- |
| `M-Tab` / `prefix Tab` | no sidebar in this window | open it — **focus does not move** |
| `M-Tab` / `prefix Tab` | open (from **anywhere**) | close it — pane killed, geometry restored |
| `M-BTab` / `prefix BTab` | no sidebar in this window | open **and** focus the sidebar |
| `M-BTab` / `prefix BTab` | open, sidebar not active | retarget `@sidebar_content_pane` at this pane, focus the sidebar |
| `M-BTab` / `prefix BTab` | open, sidebar active | focus the window's **last active pane** — sidebar stays open |

`M-Tab` opening without moving focus is why the split carries `-d`; `--focus`
selects the pane explicitly afterwards. `select-pane -T` (the title marker) was
checked live and does **not** activate its target, so it cannot defeat `-d`.

Handing focus back targets tmux's own **last active pane** (`#{pane_last}`), not
`@sidebar_content_pane`. Those differ whenever focus bounced between content panes
before entering the sidebar — `content_pane` is the navigate/open-into target,
which is a separate question from where focus came from. Falls back to
`content_pane`, then any other pane in the window. Closing from inside the sidebar
resolves the same way, so focus is never left nowhere.

`q`/`Esc` inside the sidebar also closes it, as does `tmux-sidebar-toggle --close`
(unbound; for scripts). **`q` does not implement its own close — it fires
`run-shell -b '<toggle> --close'` and quits.** Through revision 4 it cleared the
options and selected the content pane inline, which meant it silently skipped the
`@sidebar_saved_layout` replay below: closing with `M-Tab` restored the window's
pane geometry and closing with `q` didn't, and left the saved layout behind as a
stale option. `run-shell -b` runs as a child of the tmux **server**, not of this
pane, so it survives the `kill-pane` it issues — which is what lets the script stay
the single owner of kill + geometry restore + focus for both gestures.

**Why both, rather than one gesture doing everything.** They have different costs.
Open/close pays a full process respawn on every re-open — that cost was the entire
justification for the old stash-via-`break-pane` follow-up (tabby's trick:
`break-pane -d` into a hidden holding session so the renderer keeps running),
which needed an AeroSpace exclusion for the holding session's window and was never
solved. `--focus` sidesteps it: "peek at the tree and go back" never kills the
pane, so the respawn is only paid when the intent is genuinely to dismiss the
sidebar. That retires the follow-up rather than working around it.

Revision 3 put the three-state behavior on `M-Tab` alone with no open/close
binding at all, which left dismissing the sidebar reachable only from inside it.

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

Three pieces must stay aligned for `M-Tab` and `M-BTab`:

1. **Ghostty** (`ghostty/config`): `keybind = alt+tab=csi:9;3u` and
   `keybind = alt+shift+tab=csi:9;4u`. Tab is keycode 9; the CSI-u modifier is
   `1 + shift(1) + alt(2)`, so Alt is 3 and Alt+Shift is 4. Same recipe as the
   existing `alt+enter=csi:13;3u`.
2. **tmux**: `extended-keys on` + `extended-keys-format csi-u` (already set).
3. **tmux binds**: both guarded with
   `#{||:#{popup_width},#{==:#{session_name},nnn}}` so they forward raw inside
   any popup or the `nnn` session, matching the `M-j`/`M-q` pattern.

> **The focus bind must be spelled `M-BTab`, never `M-S-Tab`.** tmux rewrites
> Shift+Tab to Backtab on the **input** path (`tty-keys.c`,
> `tty_keys_extended_key`):
>
> ```c
> /* Convert S-Tab into Backtab. */
> if ((nkey & KEYC_MASK_KEY) == '\011' && (nkey & KEYC_SHIFT))
> 	nkey = KEYC_BTAB | (nkey & ~KEYC_MASK_KEY & ~KEYC_SHIFT);
> ```
>
> so Ghostty's `\e[9;4u` arrives as `M-BTab`. The **bind** parser
> (`key-string.c`) applies no such conversion, so `bind -n M-S-Tab` is accepted
> and echoed back verbatim by `list-keys` while never matching a real keypress.
> It was spelled that way from revision 3 until revision 5 and **the gesture
> silently never fired once** — `list-keys` showing the bind is not evidence it
> can match. `M-Tab` was unaffected because `\e[9;3u` carries no Shift, and
> `prefix BTab` worked because the prefix fallback already used the right name;
> that asymmetry, three lines apart in `tmux.conf`, was the tell.
>
> `prefix r` only ever *sets*, so after fixing it clear the dead bind once:
> `tmux unbind -n M-S-Tab`. And `tmux send-keys` cannot test any of this —
> root-table binds only fire on keys arriving from the terminal.

**`prefix Tab` / `prefix BTab` are bound to the same script as terminal-agnostic
fallbacks.** The `M-` forms exist only because of (1); from another emulator, or
over SSH from a machine without those mappings, they silently do nothing. The
prefix table needs no terminal cooperation, so the sidebar is never unreachable.
`Tab` maps to open/close and `BTab` (tmux's name for Shift-Tab) to the focus
switch — the same two modes, not a third behavior.

Note the sidebar's own `Tab`/`S-Tab` (cycle navigator tabs) don't collide: those
are unmodified keys delivered to the focused pane, while `M-Tab`/`M-BTab` are
root-table binds tmux consumes before the pane ever sees them.

### Pane geometry: the sidebar squeezes its neighbors

The open split uses `-f` (full window height), which makes it a **whole-window
geometry event**, not a split of one pane: tmux reflows every pane in the window
proportionally. Closing it doesn't undo that — tmux hands the reclaimed columns to
an arbitrary neighbor. Measured on a 99/40 two-pane window, a close left 109/30.

So `tmux-sidebar-toggle` snapshots `#{window_layout}` into `@sidebar_saved_layout`
*before* the split and `select-layout`s it back *after* the kill, which restores the
sizes byte-identically (verified: the layout string round-trips exactly). Only taken
when the window already has 2+ panes.

**The restore is allowed to fail, and must stay that way.** `select-layout`
validates the layout string's checksum *and* its pane count, so adding or killing a
pane while the sidebar is open makes the snapshot stale and tmux rejects it
(verified: exit 1, window untouched and usable). That degrades to tmux's own
redistribution — exactly what used to happen unconditionally. The option is cleared
either way so a stale string is never reused.

This does **not** fight the repin hook: `select-layout` re-fires
`window-layout-changed`, whose `[100]` entry is `tmux-sidebar-repin`, but
`@sidebar_pane_id` is already unset by then so repin skips the window. Note also
that this restore lives in the script and **not** in a hook — a geometry command
issued inline from a layout hook is silently discarded (same trap as below).

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

## Extending (start here to add a tab, a block, or a click action)

Everything extensible is a registry entry. The three recipes below are the whole
contract; none of them require touching `model.go`.

### Add a navigator tab

1. New file in `internal/nav/`, one type implementing `Source`:

```go
type Bookmarks struct{}

func (Bookmarks) ID() string    { return "bookmarks" } // persisted @sidebar_source
func (Bookmarks) Short() string { return "bkmk" }      // tab chip, 3-4 cells
func (Bookmarks) Title() string { return "bookmarks" } // "▸ bookmarks" subtitle

func (Bookmarks) Fetch(c nav.Ctx) []nav.Row { /* build rows */ }
```

2. Add it to `nav.Sources`. That slice's order is the tab-strip order **and** the
   number-key order.

That's it: the strip, the `1`..`N` keys, `Tab`/`S-Tab` cycling, and
`@sidebar_source` persistence all derive from the registry.

- Style rows with `c.Theme` (never a hex literal — see Colors) and return them
  pre-styled; the model only clips to width.
- A `Row` may be **multi-line** (`Lines []string`); the viewport handles variable
  heights. Give a row an action via `Kind` + its payload field, and extend
  `ActionKind`/`nav.Act` only if none of the existing actions fit.
- Need Backspace to mean "up a level"? Also implement `Ascender`. Nothing else
  binds that key, and sources that don't implement it make it inert.
- Need some state `Ctx` doesn't carry? Add a field to `Ctx` and populate it in
  `refreshState`, rather than querying tmux from the source — the per-poll tmux
  cost is deliberately one batched call.

### Add a docked block

1. New file in `internal/blocks/`, one type implementing `Block` (see below).
2. Add a `Factory` entry to `blocks.Factories`.
3. **Implement `blocks.BlockMsg` on every message type the block carries** —
   a one-line `func (YourMsg) IsBlockMsg() {}`.

Its position in that slice is both render order and **degradation priority** — a
short pane drops blocks from the END first, so put a more important block earlier.
Constructors take whatever they need from `blocks.Deps`; add a field there if a new
block needs a shared resource.

Step 3 is not optional and used to be missing. `model.Update` type-switched on
each block message **by name**, so a third block's message fell through the
default arm and its `Update` was never called: it fetched, published, and
rendered nothing, with no error anywhere. There is now one generic
`case blocks.BlockMsg:` arm that broadcasts to every block, which is what makes
"one type plus one entry" true. `AgentRowsMsg` keeps a case of its own **above**
the generic one (Go takes the first matching case) purely for its feed re-arm,
which is model-owned resolver plumbing.

`IsBlockMsg` is **exported on purpose.** An unexported marker seals the interface
to package `blocks`, so a block living in a sibling `internal/<name>/` package
could never satisfy it — reintroducing the same silent failure one package over.
A test in package `main` caught exactly that.

Two hard rules: `View(width)` must emit **exactly `Height()` lines**, and
`Height()` must be computed from already-cached state (never fetch in it, since the
layout calls it several times per frame). Both are enforced by a property test
that iterates `blocks.Factories`, so a new block is covered automatically.

### Make something clickable

Implement `Clickable` on the block. It receives the click's line offset **within
that block** (0 = its label row) and returns a `tea.Cmd`, so the block hit-tests
itself and keeps its ordering and truncation private. Return `nil` for lines that
aren't actionable. Put any tmux calls inside the returned `Cmd` — they fork and
block, and the input path must stay clear.

Blocks deliberately have **no keyboard cursor**; a click is an unambiguous point at
one row, which is why it needs neither a cursor in the block nor a traversal path
into it.

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

Blocks are listed in one ordered slice, `blocks.Factories`. **Adding a block is
one type plus one slice entry** — no layout code changes and no `model.go` edit.
(The bash version needed a hand-written case statement in three separate dispatch
functions, because macOS's `/bin/bash` 3.2 has neither associative arrays nor
namerefs to look up `fetch_$id`. An interface makes that workaround moot.)

A block that is holding data it isn't showing can additionally implement
`Expandable` (`SetExtra`/`Expand`), which lets the layout hand it leftover pane
space instead of leaving it blank. `Expand` returns its **`Height` delta, not the
row count** — showing the last hidden row also retires the `+N more` line, so a
1-row grant that clears the backlog is a net-zero height change. A block that
always shows everything simply doesn't implement it.

Each block carries a full-width `─` divider row above it (`divider-subtle`) plus
the header's `▸ <name>` subtitle idiom as its own label row. The label alone was
doing the divider's job through revision 3, which made header / navigator /
agents / system read as one undifferentiated column.

### Layout + degradation

The navigator is sized to its **actual content**; blocks float up directly
beneath it; unused space collects at the **bottom** of the pane.

1. `usable = pane_height - header_lines` (2, or 8 with the help overlay open).
2. Drop the **last** block in the slice — lowest degradation priority,
   `system_stats` before `agents_glance` — while the blocks' total
   (`Height() + 1` each, the `+1` being the divider row) exceeds
   `usable - navMinHeight` (3).
3. The navigator gets exactly the lines its rows need (a *sum*, since rows are
   variable-height), clamped to what's left after the blocks. A longer list is
   viewport-clipped around the cursor.
4. Any slack left over is offered to blocks implementing `Expandable`, which show
   more of what they already hold (`agents_glance` drops its `+N more` and lists
   everything). Whatever nothing claims stays blank at the bottom.

> **Two earlier versions of this failed the same way from opposite directions,
> so don't reintroduce either.** Giving the navigator *all* leftover space (rev
> 3), and giving it a fixed 60% share, both left a ~33-row void in the **middle**
> of a 55-row pane, between the last session row and `▸ agents`. There is no
> *share* of a 55-row pane that three sessions fill — a real pane is far taller
> than the content, so the only fix is to stop reserving space the navigator
> cannot use. Step 4 exists for the same reason at block scale: a `+1 more` line
> sitting above 30 blank rows is the identical failure in miniature.

Rows are **variable-height** (sessions/windows are two lines, filetree/scratch
one), so the viewport scrolls in whole-row units while being measured in lines,
and `navLines` records a rendered-line → row-index table (`m.lineRow`) for the
mouse handler. Deriving the row from the click's `Y` offset arithmetically only
worked while every row was exactly one line tall.

### Docked block: `agents_glance`

Always visible. Capped to 6 rows by default — it implements `Expandable`, so the
layout raises that cap when the pane has room to spare and the `+N more` line
disappears entirely once everything fits. Truncation is a render-time decision, not
baked in when a sweep arrives, so a grant takes effect immediately rather than on
the next sweep. **Sorted by urgency** (stable, so rows don't shuffle between
sweeps) with a trailing `+N more` when clipped.

**Clicking a row switches to that agent's pane**, including across sessions — it
implements `Clickable`, and `agents.Row` already carries `PaneID` (`%161`) and
`Target` (`sess:2.1`) in exactly the forms `tmuxio.FocusPane` wants, so no extra
plumbing was needed. The label row, the `+N more` counter and the `(none)`
placeholder are inert.

Still **no keyboard cursor and no `Enter`** — keyboard agent-switching stays on the
existing `M-b` menu (`tmux-claude-menu`), which already covers it, and that is also
why `agents` is not a navigator tab: the picker-vs-glance split removes a genuinely
redundant interactive surface. A click doesn't reintroduce one, because it names a
row directly instead of needing a cursor to travel there.

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

Read-only cpu/mem/disk, on its own 5s cadence (machine load doesn't need
per-keystroke freshness, and the `ps -eo pcpu` sample is the priciest recurring
call). Reuses commands already trusted in this repo rather than inventing a
measurement approach: core-count-normalized `ps -eo pcpu` per
`sketchybar/plugins/cpu.sh`, plus `vm_stat`/`hw.memsize` for memory (approximate
by design).

**Battery was removed in revision 5.** Charge is already on the macOS menu bar
and in SketchyBar, so the row spent a gauge line — and a `pmset -g batt` fork
per sample — restating something always visible in two other places. `Height()`
is now the constant **4**, which also removes the one place a block's height
depended on its sampled *values* rather than on cached state.

**`cpuThreads()` and `memTotal()` are cached behind `sync.Once`.** They read
`sysctl -n machdep.cpu.thread_count` and `hw.memsize`, which are machine
constants — they were being re-forked on every 5s sample, forever, for values
that cannot change while the process lives. A `regexp.MustCompile` for the
`vm_stat` page size was also being recompiled inside `sampleMem` each sample
(its sibling `vmStatPages` was already hoisted correctly); it is now
`vmStatPageSize` at package level. **6 forks per 5s → 4.**

**Disk measures `/System/Volumes/Data`, not `/`.** On a modern macOS install `/`
is the sealed read-only system volume, so `df /` is not a "disk full" gauge —
measured on this machine `/` reports **5%** while the data volume reports
**48%**. The bash version used `df -H /` and therefore showed 5%, which is not a
rounding difference from the truth. Falls back to `/` if the path is absent.

Each metric renders as a **20-cell block bar** — `▓` fill in `accent-secondary`
(or `accent-primary` rose when hot: cpu/mem/disk ≥ 85%), `░` track
in `divider-subtle`, then the numeric percent. This is the gauge half of
agent-manager's "computer" panel that revision 3 rendered as bare text. Bar width
is a fixed constant rather than width-reactive; `clip` handles a narrower pane.

**A nonzero reading floors at one filled cell.** At 20 cells anything under 5%
divides to an all-track bar indistinguishable from 0% — and it would also drop
the hot color entirely.

## Navigator tabs

Each tab is a `nav.Source` in the `nav.Sources` registry — see **Extending** for
how to add one.

**The `panes` tab's `ID()` is still `"windows"`, deliberately.** It emits one row
per *pane* (a 3-pane window yields three rows sharing a `sid:win` target), so the
label was corrected — but the id is the value persisted in `@sidebar_source`, and
`SourceByID` falls back to the first source on an unknown id. Renaming it would
silently reset every window's remembered tab to `sessions`. Label is cosmetic;
id is state.

| Tab | Data source | `Enter` action | Extra keys |
| --- | --- | --- | --- |
| sessions | `tmux-fzf-nav --list-sessions` | `switch-client` + `select-pane` | — |
| panes (id `windows`) | `tmux-fzf-nav --list-windows` | `switch-client` + `select-pane` | — |
| filetree | `os.ReadDir`, 2 levels, over the content pane's cwd | dir → `split-window -h -c <dir>` in the content pane; file → `tmux-open-target` | `Backspace` = up one level (via `Ascender`) |
| scratch | `~/.config/tmux_scratch/{global,<slug>}.md` | `tea.ExecProcess(nvim)` | — |

### sessions / windows

Reusing `tmux-fzf-nav` is what keeps the sidebar's session order identical to the
`M-w`/`M-s` pickers: **float first, then creation order**, a repo-wide invariant.

Rows render as **two lines**: identity on the first, cwd on the second.

```
▶ float          2w   ●        session name, window count, ● when attached;
    ~/.config                  cwd below

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

`ps -eww -o pid=,ppid=,args=` (1 fork, ~65ms — 260ms measured on a loaded machine)
and the batched `lsof -a -d cwd -Fn -p <csv>` (1 fork) run **only** when the
pane-set fingerprint changes or an agent identity isn't cached — i.e. when a pane
or agent actually appears or disappears. pi processes don't chdir, so pid→cwd is
cached for the process lifetime; pid→ppid likewise.

**A pane's `pane_pid` is its shell's, which is why pi needs a third trigger
(`piSetChanged`).** Launching pi inside an already-open pane changes no pane pid,
and pi — unlike Claude — writes no session file whose uncached ppid would force the
sweep. Through revision 4 a pi session started that way therefore **never appeared
at all** until some unrelated pane happened to open or close, and a quit pi left its
row up just as long. Both directions are now caught without a fork:

- **appeared** — a pane whose `pane_current_command` could be pi (`pi`, or `node`,
  since pi is a Node CLI whose `comm` is `node` on releases that don't set their
  process name) that isn't already a known pi pane **and whose command changed
  since the last sweep probed it** (`probedCmd`). Both extra conditions are
  load-bearing: without the pi-ish test, every command run in any pane in any
  session forces a `ps` sweep; without the changed-since-probed test, a pane running
  plain `node` forces one on every single tick forever — worse than the bug.
- **gone** — a cached pi pid failing `kill(pid, 0)`, a syscall rather than a
  process, so probing every known pi pane costs nothing measurable.

Verified live with a fake pi (real `node` running a path containing
`/pi-coding-agent/dist/cli.js`, launched as a child of an existing pane's shell):
the row appears one tick after launch and disappears one tick after `C-c`, each
costing **exactly one** extra `ps` sweep with no thrash on the ticks between.

Measured with `MMS_TRACE=1` over ~9s: 5 resolves, **1** paid the `ps` sweep
(104ms cold), the other 4 were 13.6–15.7ms. Output is byte-identical to the shell
version, including a session with no discoverable transcript and one in each of
the four states.

**Use `MMS_TRACE=1` before theorizing about a slow anything.** It logs per-phase
timings to stderr. It lives in `internal/trace` (`trace.Enabled` / `trace.Phase`)
rather than inside `internal/agents`, where it started — and that placement is
precisely why the ungated navigator poll above went unnoticed for two revisions:
the agent sweep was the only thing instrumented, so it was the only thing anyone
measured. Phases now cover `refresh-total`, `tmux-query`, `tmux-list-panes`,
`source-fetch:<id>` / `source-skipped`, and the resolver's own. It exists because a 1.3s outlier appeared in 8 runs (and once,
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
- **pi:** `extensions/session-state/` writes `/tmp/pi-session-state/<pid>.json`
  atomically on every session start/reload/new/resume/fork. It holds the exact
  session ID, transcript path, and cwd. The resolver validates that the record's
  PID is a live pi process, that its cwd still matches, and that its session file
  is inside pi's session store. A pi process may equal `pane_pid` after shell
  `exec`, or be its direct child. Only unreloaded older pi instances use the
  marked compatibility fallback: cwd → pi's `--<cwd sans leading slash,
  remaining slashes as dashes>--` session directory → newest `*.jsonl`.

**fsnotify** watches `claude/sessions/`, `/tmp/claude-session-state/`, and
`/tmp/pi-session-state/`, so agent state changes push rather than waiting for
the next tick. The periodic tick remains the backstop for legacy pi detection.

**One deliberate behavior fix:** pi state was `idle` only when
`pane_current_command == "pi"`, but pi is a Node CLI whose `comm` is `node` on
releases that don't set their process name — which is also why a pi pane's tmux
window auto-names itself `node`. Every such pane therefore reported a permanent
`thinking`. The comparison is now against the resolved pi process's own argv[0]
basename, which is what the recipe intended.

### The 10-field TSV schema

`mm-sidebar agents` emits, tab-separated:

```
sessionId  pane_id  target  session_name  state  name  transcript  window_name  agent  cwd
```

`agent` ∈ `claude` | `pi`; `state` ∈ `awaiting-permission` | `waiting` |
`thinking` | `idle`. `cwd` is the owning **pane's** `pane_current_path` — for pi
that is deliberately the pane's cwd and not the pi *process's* cwd (which
`piTranscript` uses to find the session dir), so both agent kinds' `cwd` means
the same thing and can be joined against a repo root.

**`cwd` was APPENDED as field 10 in revision 5, never inserted.** Fields 1-9 are
a contract with shell consumers; verified byte-identical after the change by
diffing `cut -f1-9` against the pre-change binary. Appending is still not free,
though — see the next paragraph.

**No field is ever emitted empty** — `-` is the placeholder. bash's `read` with
`IFS=$'\t'` collapses *consecutive* delimiters regardless of what IFS is set to
(tab is always "IFS whitespace" to bash's field splitter), so one genuinely empty
field shifts every later field left by one. That is exactly what produced the old
`[]` empty agent tag, with `wname`/`agent` silently swapped.

**Appending a field breaks any consumer that reads exactly N variables**, because
bash's `read` puts every remaining field into the LAST variable. Adding `cwd`
made the legacy dispatcher's 9-variable read return
`agent="claude<TAB>/Users/…"`, rendering a garbled `[claude /Users/…]` tag.
`tmux_scripts/tmux-sidebar` now ends its `read` with a trailing `_rest` catch-all
so a future append cannot corrupt it again; do the same in any new consumer.

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
**no hex literals in the sidebar.** `internal/theme` resolves seven `@color-*`
tmux options at startup; the hexes in that file are *fallbacks only*, for when
the binary runs outside a tmux server (`mm-sidebar agents` from a plain shell).
The `roles` map there is the single enumeration of the palette — both the batch's
name list and the fallback table — so a role can't be added to one and forgotten
in the other.

**The palette is read in ONE tmux fork** (`tmuxio.GlobalOpts`, the same
`#{@user_option}` token/separator pattern `Query` uses). One `show -gqv` per role
measured **20ms each, 112ms for the set** — paid before Bubble Tea starts, i.e. as
a blank pane, on every `M-Tab` open. That is the same gesture whose respawn cost
justified splitting `M-BTab` out, so seven forks was the worst possible place to
spend them.

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
| `1`–`4` | Switch to sessions / windows / filetree / scratch (`1`..`N` over `nav.Sources`) |
| `Tab` / `S-Tab` | Cycle tabs forward / back |
| `j` `k` / `↓` `↑` | Move cursor (navigator only, wraps) |
| `g` / `G` | First / last row |
| `Enter` | Act on the selected row (tab-specific) |
| `Backspace` | Up one level in a hierarchical tab (filetree); inert elsewhere |
| `r` | Force refetch |
| `?` | Toggle help overlay |
| `q` / `Esc` | Close the sidebar (delegates to `tmux-sidebar-toggle --close`) |
| click (navigator) | Select the clicked row |
| click (agents row) | Switch to that agent's pane |
| wheel | Scroll the navigator viewport — clamped, and only over the navigator |

Docked blocks have **no keys** — they're glances, not pickers — but a block may
accept a click by implementing `Clickable` (see Extending).

**The wheel is a clamped, position-scoped viewport scroll, not a cursor move.**
Through revision 4 it called the same wrapping `move()` that `j`/`k` use, from
anywhere in the pane — so a flick past the last row teleported the cursor to the
top, and scrolling over the `system` gauges (which hold no cursor at all) moved the
navigator's. It now adjusts `vpStart`, drags the cursor along only when it would
leave the visible window, and ignores any wheel event whose `Y` is outside the
navigator's own lines. `j`/`k` keep wrapping — that's a keyboard convenience; a
wheel that wraps just reads as a glitch. The visible row span comes from
`m.lineRow`, for the same reason clicks do: rows are variable-height, so it can't
be derived from a line count.

Mouse works because tmux already has `mouse on` and Bubble Tea enables SGR
tracking (`WithMouseCellMotion`). A click resolves through two tables `View`
records as it renders: `lineRow` for the navigator, then `blockLines` for the
region below it. Both are recorded rather than recomputed, so they cannot disagree
with the frame — and `Height()` read after the fact would reflect the previous
frame's `Expandable` grant anyway. Verified by injecting raw SGR sequences.

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

## Tests

`go test ./...` in the module. 10 tests, all pure logic — nothing shells out to
tmux, so they run anywhere:

- `model_test.go` — the **Leak A regression guard**: a stub block with a message
  type `model.go` has never heard of must still reach that block's `Update`. Plus
  the help-overlay invariants (`len(helpOverlay()) == helpLineCount`, and the tab
  count is derived from `nav.Sources` rather than written out).
- `internal/blocks/blocks_test.go` — a **property test over `blocks.Factories`**
  asserting `View(width)` emits exactly `Height()` lines across a grid of widths;
  `Height()` stability without an intervening `Update`; unique block IDs (the
  tick router matches by ID, so a duplicate would starve its twin); non-zero
  `Interval()` (a zero would spin `tea.Tick`); the `sync.Once` machine-constant
  cache; and `gauge()` against out-of-range percentages, since `sampleCPU` can
  briefly exceed 100 and `strings.Repeat` panics on a negative count.

Construct blocks with a **buffered** `Deps.Agents` channel — `AgentsGlance.Fetch`
does a non-blocking send and needs somewhere for it to go.

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
kill-on-close, and `M-BTab` (the focus switch) means the sidebar isn't killed
incidentally in the first place — the respawn is only paid on a deliberate
`M-Tab` dismissal. Don't reintroduce it.
