# mm-sidebar

> Canonical reference for the `M-Tab` tmux sidebar. Cross-references:
> `AGENTS.md` "tmux sidebar" section, `KEYBINDS.md` "tmux — sidebar" section,
> `COLORS.md` "mm-sidebar integration" section. Session logs:
> `mm-sidebar-HANDOFF.md`.
>
> Renamed from `mega-michael-sidebar` in revision 3.

A leftmost, full-window-height tmux pane toggled by `M-Tab`, running a compiled
Go/Bubble Tea TUI. Its normal surface is intentionally sparse: a 2-line header,
a tab-switchable navigator (sessions / panes / projects / filetree / scratch),
and a compact attention section only when an agent is awaiting permission or
waiting for input. Thinking/idle agents, activity history, system gauges, and
agent detail live behind the explicit `v` views palette.

The design is progressive disclosure, not density maximization. Blank space at
the bottom is preferable to persistent panels that repeat SketchyBar/macOS or
render placeholders. Dedicated tools remain available (`M-s`, `M-w`, `M-b`,
`M-d`); the sidebar keeps broad capabilities without showing all of them at once.

## Layout

Normal, no blocker:

```
1sess 2pane 3proj 4tree 5scr
▸ panes
▶ 1:node         node
    ~/.config

                    blank by design
```

Normal, blockers present:

```
1sess 2pane 3proj 4tree 5scr
▸ panes
▶ 1:node         node
    ~/.config
─ attention ───────────────────────
  !P build · m*
  !W review · m*
```

Attention is permission-first, waiting-second, capped at four agent rows. A
`+N more · v agents` row opens the full roster; hidden agents are not direct
action targets. `v` opens full agents, activity-history, and system-health views.
`Esc`/`q` returns from those views to normal; on normal it retains the existing
global sidebar dismissal.

The pane defaults to **36 columns** with window-local 30/36/44 presets. Every
surface emits exactly `pane_height` lines and derives mouse hit maps from that
same frame. Navigator loading, successful-empty, no-match, and error states are
distinct; projects therefore shows `loading projects…` during its bounded cold
inventory rather than temporarily claiming `(empty)`.

## Components

| Path | Role |
| --- | --- |
| `tmux_scripts/mm-sidebar/` | The Go module. `go.mod`/`go.sum` tracked; the architecture-specific binary is generated on demand and ignored. |
| `tmux_scripts/tmux-sidebar-toggle` | Persistent-mode toggle, local focus switch, and owner-safe pane lifecycle. |
| `tmux_scripts/tmux-sidebar-sync` | Hook-driven reconciler: ensures the selected window has one sidebar while persistent mode is enabled. |
| `tmux_scripts/tmux-sidebar-build` | Builds or repairs the binary on demand; prints its path, or exits 1 so callers can fall back. |
| `tmux_scripts/tmux-sidebar-repin` | Restores every sidebar pane to its configured width after a resize. |
| `tmux_scripts/tmux-agent-ls` | Thin wrapper over `mm-sidebar agents` (the only copy of the join). |
| `tmux_scripts/tmux-sidebar` | **Legacy bash dispatcher**, retained only as the no-Go-toolchain fallback. |

### Go module layout

| Package | Responsibility |
| --- | --- |
| `main.go` | Entry point; `mm-sidebar` (TUI) and `mm-sidebar agents` (TSV) subcommands. |
| `model.go` | Bubble Tea model: state refresh, keys, mouse, `View`, the agent feed, fsnotify. |
| `layout.go` | The vertical arrangement: navigator/block sizing and block degradation. |
| `internal/tmuxio` | **The only place that talks to tmux.** Each tick reads the local snapshot, ordered sessions, and global panes; each response is batched. |
| `internal/theme` | Resolves the `@color-*` palette into `lipgloss` styles. |
| `internal/agents` | The Claude + pi pane join. |
| `internal/agentdetail` | Bounded local selected-agent prompt/response, plan, cwd/worktree, and Git inspector. |
| `internal/nav` | The navigator tabs (`Source` registry), optional source controls/help actions, and their `Enter` actions. |
| `internal/blocks` | Agent roster/attention, activity history, system sampling, and explicit-view interaction. |
| `internal/projectcatalog` | Persistent XDG-backed repository identity/inventory: canonical common dirs, pinned/recent retention, validated roots, flocked schema-v1 state. |
| `internal/worktrunk` | Optional bounded Worktrunk schema-2 list/switch adapter; Git remains discovery authority. |
| `internal/trace` | `MMS_TRACE=1` per-phase timing, shared by every package. |

Within `internal/nav`: `source.go` is the contract plus the `Sources` registry,
one file per source (`sessions.go`, `windows.go`, `projects.go`, `filetree.go`, `scratch.go`),
`fzfnav.go` is what sessions and windows share, `act.go` performs an ordinary
Enter action, `actions.go` owns row context-action descriptors and dispatch, and
`keys.go` defines the optional source key-action contract used by help.

## State (global desired state + window-local owners)

`@sidebar_persistent` is a global desired-state option. When it is set, indexed
selection/layout hooks ensure one sidebar per selected window/session; each is a
separate window-owned pane and is never moved between windows. All owner state
below is `setw -w`, so each window remembers its own tab, width, content target,
and lifecycle transaction.

| Option | Meaning |
| --- | --- |
| `@sidebar_persistent` | Global desired state (`1` while synchronized sidebars are enabled). |
| `@sidebar_pane_id` | This window's sidebar pane. Unset when closed. |
| `@sidebar_content_pane` | The pane the sidebar navigates/opens into. Retargeted to whichever pane you `M-BTab` *from*. |
| `@sidebar_source` | Active tab — any `nav.Source`'s `ID()` (`sessions`\|`windows`\|`projects`\|`filetree`\|`scratch`). **Deliberately not cleared on close**, so re-opening restores your tab. An unrecognized value falls back to the first registered source. |
| `@sidebar_width` | Width preference for this window. `w` cycles 30/36/44; unset falls back to `TMUX_SIDEBAR_WIDTH` then 36. |
| `@sidebar_saved_layout` | The window's `window_layout` from just before the sidebar opened, replayed on close to undo the squeeze. Cleared on close, including when the replay is rejected as stale. |

Per-pane marker: `@sidebar_pane 1` + pane title `sidebar`, so `tsave`, border
coloring, automatic rename, and all navigator sources can identify infrastructure
panes. `tmuxio.World` carries this marker; sessions/panes exclude every marked
pane, including sidebars belonging to other windows or sessions.

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

The optional `RootSynchronizer` owns a source browse root. Filetree re-derives
its root from the content cwd only when that pane changes and the root is not
pinned; `p` pins it, `R` resets and unpins it, and Backspace ascent therefore survives later
polls. The model does not name filetree for any of these controls.

### Cached diagnostics and action-derived help (phase 10)

`d` opens an exact-height diagnostics/help modal. It renders only the latest
accepted `World`/fingerprint, source/root/filter/watch state, visible blocks,
refresh timing/counters, retained state/fetch errors, and sidebar/content/client/
window/session IDs. Opening it executes **no** tmux, Git, filesystem, or process
command; it is a view of state already collected by the normal refresh.

The compact `?` overlay and the diagnostics action list both combine registered
global actions with the active source's optional `ActionProvider` descriptors.
A source that accepts local keys must advertise them there (filetree advertises
`h`, `p`, `R`, and Backspace), so adding a source extension cannot leave help
stale. `d`, `Esc`, `q`, Enter, or Space closes the diagnostics modal.

### The poll is gated (revision 5)

Through revision 4 `refreshState` ran the active source's `Fetch()` on **every**
2s tick, unconditionally. The current design instead builds one immutable
`tmuxio.World` from a targeted local snapshot, creation-ordered session metadata,
and one global pane list. Sessions, panes, and agents share that observation.

A length-framed in-process fingerprint covers every rendered session/pane field.
The active source fetches only when its source/content/cwd/root/options/invalidation
key changes; monotonic refresh sequencing and agent World fingerprints reject late
completions. `r` forces a fetch. On projects it is the deliberate Git/Worktrunk
metadata refresh, because recurring external polling is forbidden. Filetree changes arrive via
its scoped two-level fsnotify watcher. Pane liveness/cwd and content retargeting
come from `World.PaneSet`, with no per-pane query path.

## `M-Tab` / `M-BTab`: persistent mode and local focus

`M-Tab` / `prefix Tab` dispatch `--toggle-persistent`: if off, they set global
`@sidebar_persistent=1` and ensure the current owner without moving focus; if on,
they clear it and close all marked sidebars through their individual canonical
close transactions. `tmux-sidebar-sync` is invoked only by indexed tmux
selection/layout lifecycle hooks, never by a recurring poll. It chooses a stable
non-sidebar content pane and calls idempotent `--ensure`.

| Key | State | Result |
| --- | --- | --- |
| `M-Tab` / `prefix Tab` | persistence off | enable and ensure current window — **focus does not move** |
| `M-Tab` / `prefix Tab` | persistence on | disable and close all sidebar owners, restoring geometry/zoom |
| `M-BTab` / `prefix BTab` | no sidebar in this window | open **and** focus this window's sidebar |
| `M-BTab` / `prefix BTab` | open, sidebar not active | retarget `@sidebar_content_pane` at this pane, focus the sidebar |
| `M-BTab` / `prefix BTab` | open, sidebar active | focus the window's **last active pane** — sidebar stays open |

The `-d` split keeps focus in content on an ensure/open; `--focus` explicitly
selects afterwards. `select-pane -T` only sets the title and does not activate the
pane. While a marked sidebar is focused, `automatic-rename-format` preserves the
current window name; content-pane Claude/command auto-renaming is unchanged.

Handing focus back targets tmux's own **last active pane** (`#{pane_last}`), not
`@sidebar_content_pane`. Those differ whenever focus bounced between content panes
before entering the sidebar — `content_pane` is the navigate/open-into target,
which is a separate question from where focus came from. Falls back to
`content_pane`, then any other pane in the window. Closing from inside the sidebar
resolves the same way, so focus is never left nowhere.

Outside filters and modals, `q` and `Esc` clear `@sidebar_persistent` before
calling `--dismiss`: every other owner closes first and the invoking pane closes
last, preserving every layout/zoom/focus transaction. `Esc` still clears an active
filter first. `--close` remains unbound and deliberately local for signal/failure
cleanup; it must not clear global desired state, so hook-driven recovery can repair
that one crashed owner.

**Why both, rather than one gesture doing everything.** They have different costs.
Open/close pays a full process respawn on every re-open — that cost was the entire
justification for the old stash-via-`break-pane` follow-up (tabby's trick:
`break-pane -d` into a hidden holding session so the renderer keeps running),
which needed an AeroSpace exclusion for the holding session's window and was never
solved. `--focus` sidesteps it: "peek at the tree and go back" never kills the
pane, so the respawn is only paid when the intent is genuinely to dismiss the
sidebar. That retires the follow-up rather than working around it.

Persistent mode supersedes the former window-local M-Tab open/close behavior:
M-Tab now controls desired state across visited windows, while M-BTab remains the
local focus gesture.

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
- **Deterministic focus on close.** Each local owner computes its return pane
  before clearing state, so global dismissal restores every window without
  leaving focus to tmux's arbitrary redistribution.

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
`Tab` maps to the persistent-mode toggle and `BTab` (tmux's name for Shift-Tab)
to the focus switch — two distinct, intentional behaviors.

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

## Progressive-disclosure architecture

The model has six explicit surfaces: `main`, `views`, `agents`, `activity`,
`system`, and `inspector`. This is intentionally a small closed state model, not
a generic proposal/mode allocator.

- `main` renders the header, active navigator, and blocker-only agent attention.
- `views` is the `v` palette.
- `agents` renders the complete all-state roster and its guarded actions.
- `activity` renders the existing bounded process-local transition history.
- `system` samples cpu/mem/disk only while open; a pending tick stops rearming
  after leaving the view.
- `inspector` starts only from an explicit agent action. It preserves bounded
  transcript/plan reads, Git timeouts, stable identity/generation rejection, and
  the short cache, while omitting missing fields and duplicate cwd/worktree.

Collection and presentation are separate. `tmuxio.World`, the serialized agent
resolver, activity transition state, and source fetches keep their existing
owners. Presentation-hidden does not mean absent data: agents and activity still
consume accepted messages. System telemetry is the deliberate exception—there
is no hidden `ps`/`vm_stat`/`df` sampler.

### Navigator source contract

A tab remains one `nav.Source` in `nav.Sources`; registry order controls the tab
strip and `1`..`N` keys, and `ID()` is persisted in `@sidebar_source`. Keep the
panes source ID as `windows`. Optional `RootSynchronizer`, `SourceController`,
`Watchable`, `FetchKeyer`, and `ActionProvider` keep source-specific behavior out
of the model. A source fetch must return stable row IDs and real action payloads;
display strings are never scraped back into paths or tmux identities.

### Explicit view/block contract

`internal/blocks` still owns the agent roster, activity history, and system
sampler. Messages implement `BlockMsg` so accepted updates broadcast without a
concrete-type arm. `Navigable`, `Clickable`, `Hoverable`, `SelectionIdentifiable`,
and `Actionable` retain guarded row interaction. The removed
`SelectionChangeAware`/`Refreshable` path must not return: selection is not an
I/O trigger. Inspector work is explicit through `inspect agent`.

The main layout never expands content merely to consume height. Agent attention
has an integrated one-line heading and a fixed four-row cap. Full agents and
activity views may expand their already-cached lists to the available height.
Unused lines are padded at the bottom.

### Add a navigator tab

1. Implement `nav.Source` in `internal/nav/`.
2. Add it to `nav.Sources`.
3. Add source controls through the optional interfaces, not source-ID branches.
4. Add loading/empty/error, filtering, action, and exact-height tests.

Adding a new progressive view is a deliberate product change: add its surface,
`v` entry, collection policy, key routing, and branch-specific render tests.
Do not turn ordinary information into another always-visible main panel.

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
| sessions | shared `tmuxio.World` sessions + panes | guarded focus of the session's active content pane | — |
| panes (id `windows`) | shared `tmuxio.World` panes | identity-guarded pane focus | — |
| projects | Persistent catalog observed from live pane cwds; optional bounded Worktrunk schema-2 `wt list --branches`, with per-repository Git porcelain fallback | focus/open an existing worktree; branch-only row palette materializes it with `wt switch --no-cd`, then guarded split | pin/unpin; confirmed forget only when non-live; no recurring Git/Worktrunk polling |
| filetree | `os.ReadDir`, 2 levels, over the content pane's cwd | dir → `split-window -h -c <dir>` in the content pane; file → `tmux-open-target` | `h` hidden, `p` pin, `R` reset/unpin, `Backspace` up (all via optional source controls) |
| scratch | `~/.config/tmux_scratch/{global,<slug>}.md` | `tea.ExecProcess(nvim)` | — |

### sessions / panes

Both render directly from the immutable shared `tmuxio.World`. Sessions are
stable-grouped **float first, then numeric creation ID**, preserving the same
repo-wide order as the `M-w`/`M-s` pickers without launching their adapter.

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

### projects

The projects tab observes the **already-collected** live pane cwd set only when
the tab's gated `Fetch` runs. `internal/projectcatalog` identifies each repository
by its absolute, symlink-resolved Git common directory and records one
representative root, pin state, and UTC `last_seen`. Its state is private machine
state at `$XDG_STATE_HOME/mm-sidebar/projects.json` (or
`~/.local/state/mm-sidebar/projects.json`): schema v1, a narrow legacy-array
migration, a sibling `projects.json.lock` flock, and a 0600 same-directory
fsync/atomic-rename/directory-sync write. Future-version or corrupt files are
preserved untouched. It retains every pinned repository plus the 20 most-recent
unpinned records.

Each persisted root is re-resolved before rendering. Missing, non-Git, or
reused paths render an unavailable two-line repository heading with no child
worktrees; they remain safely forgettable. Available repositories render an inert
two-line heading followed by indented materialized worktrees and branch-only
children. Headings support `a`/`:` pin/unpin and confirmed forget; forget is not
offered while a matching live pane exists. Filtering retains a matching child's
heading so group context is never lost. Catalog ordering is pinned first, then
recent `last_seen`, with deterministic name/path/common-dir ties; child ordering
remains materialized before branch-only, main first, then branch/path.

For each available repository, the optional `internal/worktrunk` adapter runs a
local-only `wt list --branches --format=json` with schema 2 and renders worktree
changes, ahead/behind, conflict, operation, lock/prunable, integration, and
branch-only facts. One four-worker pool and shared 3-second deadline bound total
Worktrunk latency across the retained catalog; missing, timed-out,
approval-blocked, malformed, or unsupported output falls back per repository to
bounded NUL-delimited `git worktree list --porcelain -z`. Neither Worktrunk nor Git runs on unchanged
2-second World ticks; `r` is the explicit metadata refresh. Live worktrees show
pane counts and focus the shallowest matching pane; absent worktrees open a
guarded split rooted there.

Each materialized worktree owns an ordered `a`/`:` action center: optional focus
of its live pane, shell split, shell window, pinned filetree, lazygit, project
scratch, new pi window, new Claude window, copy path, and Finder reveal. Every
descriptor retains the cleaned absolute worktree path and canonical common-dir
identity. Repository identity is revalidated asynchronously before local
filetree/scratch effects and immediately before guarded tmux tool/agent launches.
Tmux actions also revalidate the immutable content-pane session/window identity
inside one `if-shell`; agent launches are limited to fixed `exec pi` /
`exec claude` commands. Filetree switches through the source registry, resets
stale filter/selection/rows, and re-arms its scoped watcher; scratch uses the
existing `tea.ExecProcess(nvim)` lifecycle and creates its parent directory. The
lazygit launcher accepts cwd/client as argv while its no-argument `M-g` behavior
and generated palette config remain unchanged.

A branch-only row is inert on ordinary Enter and exposes `create worktree and
open split`. It re-resolves its root and requires the rendered canonical common
dir immediately before `wt switch <branch> --no-cd --format=json`, as well as
validating the immutable content-pane identity. It never uses `--create`,
`--yes`, or `--no-hooks`; success opens the returned path through the same pane
guard. This materializes existing local branches only. Worktrunk errors are
shown as concise tmux messages. The sidebar never creates a new branch, merges,
removes a worktree/branch, approves hooks, or reaches network-backed `--full`
list data.

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

### The 11-field TSV schema

`mm-sidebar agents` emits, tab-separated:

```
sessionId  pane_id  target  session_name  state  name  transcript  window_name  agent  cwd  pane_label
```

`agent` ∈ `claude` | `pi`; `state` ∈ `awaiting-permission` | `waiting` |
`thinking` | `idle`. `cwd` is the owning **pane's** `pane_current_path` — for pi
that is deliberately the pane's cwd and not the pi *process's* cwd (which
`piTranscript` uses to find the session dir), so both agent kinds' `cwd` means
the same thing and can be joined against a repo root.

**`cwd` (field 10) and `pane_label` (field 11) were APPENDED, never inserted.**
Fields 1-9 are a contract with shell consumers; fields 1-10 remain byte-identical
when the label was added. `pane_label` comes from `@pane-label` in the existing
batched `list-panes -a` format, so it adds no recurring fork. Appending is still
not free, though — see the next paragraph.

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

### Main

| Key | Action |
| --- | --- |
| `1`–`5`, `Tab` / `S-Tab` | Select/cycle sessions, panes, projects, filetree, scratch |
| `j/k`, arrows | Move within navigator or attention |
| `J/K`, F13/F14 | Rotate navigator ↔ attention without acting |
| `g/G`, Enter | First / last / activate |
| `/`, Backspace | Filter; filetree parent when not filtering |
| `h/p/R` | Filetree hidden / pin / reset |
| `a` / `:` | Selected-row actions |
| `v` | Explicit views palette |
| `r` | Force source refresh |
| `w` | 30/36/44 width |
| `?`, `d` | Help / cached diagnostics |
| `q`, Esc | Dismiss all sidebars; Esc clears filter first |

### Explicit views

`v` lists agents, activity history, and system health. `j/k`, `g/G`, Enter,
`a`/`:`, and `r` operate on the selected view. `Esc`/`q` returns to main. Agents
shows all states; activity preserves guarded agent/worktree actions; system
samples on open and only rearms its 5-second cadence while still open.

The agent action palette starts with `inspect agent`. The inspector is a full
surface; selection alone never reads transcript, plan, or Git. `r` forces a
fresh inspection; Esc/q returns to agents.

## Relationship to `M-d` and `M-b`

- The sidebar **filetree** is the quick-nav variant — no preview, just open.
  `M-d` (`tmux-nnn-explorer`) remains the full popup explorer with
  preview/moor/fzf/fzrg. They coexist; don't collapse them. The filetree reuses
  `tmux-open-target` for file opens, so the only real difference is the browsing
  UI.
- Main-surface **attention** is the blocker-only quick glance; `v` → agents is
  the complete sidebar roster with focus/actions/explicit inspection. `M-b`
  remains the richer cross-session picker with transcript preview and bulk
  actions. These are progressive layers, not competing always-visible panels.

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
`M-Tab`. The architecture-specific `mm-sidebar` binary is not tracked and is
ignored by `.gitignore`; the helper rebuilds it on demand. Run `go build ./...`
in the module directly to see errors. Its freshness
gate also runs `mm-sidebar --help`: executable mode and mtimes alone do not prove
a Mach-O is runnable. A stale binary with an invalid `LC_CODE_SIGNATURE` passes
both checks, then macOS kills the sidebar with `SIGKILL` before its first frame.
The helper rebuilds that artifact and health-checks the temporary output before
publishing it via atomic rename.

## Phase 1–10 verification map

| Phase | Verified contract |
| --- | --- |
| 1 | Isolated real-tmux lifecycle/key/zoom/fallback harness. |
| 2 | Immutable pane/client context and explicit tmux targets. |
| 3 | Transactional open/close rollback, canonical cleanup, layout/focus/zoom restore. |
| 4 | q/a arbitrary-string transport, control-safe rendering, stable row identity/search. |
| 5 | Shared immutable World, complete invalidation, ordered refresh/error/cache recovery. |
| 6 | Scoped watcher/worker shutdown, hidden-block suspension, coalesced re-pin, recursive build freshness. |
| 7 | Order-preserving Unicode/paste filter with exact-height query/mouse layout. |
| 8 | Pane labels, guarded action palette, alert badges, window-local width presets. |
| 9 | Projects, filetree controls, guarded on-demand pane preview, reused agent dispatchers. |
| 10 | Cached `d` diagnostics/help, registry-derived help, full verification and canonical docs. |

## Tests

`go test ./...` in the module. The tests are pure logic — nothing shells out to
tmux, so they run anywhere:

- `model_test.go` — the **Leak A regression guard**: a stub block with a message
  type `model.go` has never heard of must still reach that block's `Update`. Plus
  exact-height checks for compact help and cached diagnostics, and the action
  registry check that combines global `d` with filetree's optional local keys.
- `internal/blocks/activity_test.go` — silent baselines, every required agent/Git transition, bounded retention, stale-token rejection, visible trigger-only Git work, interactions, clipping, and inert empty/more rows.
- `tmux-agent-action-protocol-test.sh` — no-argument, legacy two-argument, and expected-agent/session dispatch compatibility plus stale-session rejection.
- `internal/blocks/blocks_test.go` — a **property test over `blocks.Factories`**
  asserting `View(width)` emits exactly `Height()` lines across a grid of widths;
  `Height()` stability without an intervening `Update`; unique block IDs (the
  tick router matches by ID, so a duplicate would starve its twin); safe timer
  intervals (zero is an intentional passive block and schedules no `tea.Tick`);
  the `sync.Once` machine-constant
  cache; and `gauge()` against out-of-range percentages, since `sampleCPU` can
  briefly exceed 100 and `strings.Repeat` panics on a negative count.

Construct blocks with a **buffered** `Deps.Agents` channel — `AgentsGlance.Fetch`
does a non-blocking send and needs somewhere for it to go.

`tmux_scripts/tmux-sidebar-build-test.sh` builds in an isolated home, replaces
the published binary with a deterministic failing executable while leaving it
newer than its sources, and asserts that the next helper invocation repairs it.

`tmux_scripts/mm-sidebar-integration-test.py` starts a disposable real tmux
server and covers launcher lifecycle: signal rollback after split, the
pre-publication child gate, kill failure retry, and moved-pane ownership safety.
It also exercises `switch-client -c` compatibility directly. The remaining
boundary is intentionally explicit: it does not script a Bubble Tea
cross-session navigator selection, so origin-client propagation through that UI
path remains covered by the model/client contract plus direct-tmux compatibility,
not an end-to-end terminal interaction.

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
4. **`tload` doesn't restore sidebar panes.** `tsave` filters them out. Enable
   persistent mode with `M-Tab` after restore (or select each restored window
   while it is already enabled); synchronization creates fresh owner-safe panes
   rather than replaying saved sidebar processes.

## Stash-via-`break-pane`: closed, not deferred

Previous revisions carried this as follow-up #1: on close, `break-pane -d` the
sidebar into a hidden holding session so the renderer keeps running and re-open is
instant. It was deferred because the holding session's window gets tiled by
AeroSpace, needing an autohide/floating workspace or an AeroSpace exclusion.

**It is no longer wanted.** Its only purpose was hiding the respawn cost of
kill-on-close, and `M-BTab` (the focus switch) means the sidebar isn't killed
incidentally in the first place — the respawn is only paid on a deliberate
`M-Tab` dismissal. Don't reintroduce it.
