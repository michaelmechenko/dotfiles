# mm-sidebar — session handoff

> Written at the end of the implementation session. A refining agent should
> read this alongside `mm-sidebar.md` (the stable reference) to
> understand what was built, what was verified, what's known-rough, and where
> to pick up. The reference doc has the architecture; this doc has the
> session-time decisions and gotchas hit.

## What was implemented

A neo-tree-like tmux sidebar, toggled by `M-Tab`, with 5 tabbed sources
(sessions / windows / agents / filetree / scratch). Three new scripts, one
tmux bind, one Ghostty keybind, one gitignore entry, and three doc updates.

## How it was done (in order)

1. **Reachability check (step 1).** `M-Tab` isn't stock-reachable. Added
   `keybind = alt+tab=csi:9;3u` to `ghostty/config` (Tab = keycode 9, Alt = 3,
   CSI-u = `\x1b[9;3u` — same recipe as the existing `alt+enter=csi:13;3u`).
   Added a temporary `bind-key -n M-Tab display-message "M-Tab reached tmux"`
   to `tmux.conf`, reloaded both, and confirmed the message appeared. Then
   removed the diagnostic bind and added the permanent guarded bind. This was
   the single biggest unknown — verified before any rendering work.

2. **Pane lifecycle (`tmux-sidebar-toggle`).** `split-window -h -b -l 28` puts
   the new pane to the **left** of the current pane (`-b` = before/left), 28
   cols wide. `-P -F '#{pane_id}'` captures the new pane id. State stored in
   window-scoped options (`setw -w`). Close path: `kill-pane` + `set-option
   -wqu` to clear. Double-guards against popups/nnn (the bind already guards,
   but the script re-checks for direct invocation).

3. **Dispatcher TUI (`tmux-sidebar`).** One bash script, ~300 lines. Tab strip
   (short labels `sess`/`win`/`ag`/`tree`/`scr` to fit 28 cols) + body. Key
   loop: `while :; do render; k=$(read_key); handle_key; done` with
   `read -rsn1 -t 2` for a 2s re-poll timer. ANSI rendering via `printf
   '\033[38;2;R;G;Bm'` (palette hex read from `@color-*` options at startup).

4. **`tmux-agent-ls`.** Wraps `tmux-claude-ls` (appends `claude` column) + adds
   pi rows via the `tmux-pi-last-response` detection recipe. Verified it emits
   rows: `pi:<pid> <pane> <target> <session> <state> - <transcript> <wname> pi`.

5. **Docs.** `KEYBINDS.md` (bind row + sidebar section), `AGENTS.md` (source-of-
   truth section), this handoff, and `mm-sidebar.md` (reference).

## Gotchas hit during implementation

- **`tmux send-keys` does not trigger root-table binds.** To test the `M-Tab`
  bind from outside, you can't `tmux send-keys -t <pane> M-Tab` — that injects
  the key *after* tmux's keybinding layer, into the pane's process. Root-table
  binds only fire on keys from the terminal. Workaround for testing: run
  `tmux-sidebar-toggle` directly. To exercise the bind itself, press the
  physical key (or use a terminal-level test).
- **`list-keys -T root M-Tab` doesn't filter the way you'd expect.** The bind
  *is* loaded (shows in `list-keys -T root` full output) but
  `list-keys -T root M-Tab` returns nothing. Don't conclude the bind is missing
  from that alone — grep the full `list-keys` output.
- **`read -t 2` returns immediately off a non-tty.** When testing the
  dispatcher's read loop from a plain bash invocation (not a tmux pane), the
  2s timeout doesn't hold and the loop spins. Always test inside
  `tmux split-window` so stdin is the pty.
- **`capture-pane ... | tail` can hide the content.** The sidebar is a 35-row
  pane; the rendered content is at the **top** (after `\033[H\033[2J` clears
  and homes). `tail` drops it and shows blank rows — looked like the renderer
  was broken for a while. Use `head` or grep for the cursor `▶` when verifying.
- **Stale capture frames.** `send-keys` delivers a key; the dispatcher handles
  it and re-renders, but a `capture-pane` 0.3s later may catch the pre-render
  frame. Wait ≥1s (or send `r` + wait) before capturing when verifying tab
  switches.
- **Tab strip wrapping at 28 cols.** Initial labels `sessions`/`windows`/etc.
  wrapped. Shortened to `sess`/`win`/`ag`/`tree`/`scr` with no padding — fits.
- **Double cursor in scratch tab.** `render_scratch` added its own `▶ ` prefix
  *and* the print loop added `▶ ` for `$sel`. Removed the in-row prefix;
  `scratch_sel` is synced to `sel` so the dispatcher's cursor lands right.
- **`set -uo pipefail` (no `-e`).** Errors don't exit the dispatcher (a failing
  render function just leaves `rows` empty → blank body, not a crash). This is
  intentional — a transient `tmux display-message` failure shouldn't kill the
  sidebar. If a tab goes blank, check the render function's data source, not
  the process.

## What's verified working

- `M-Tab` reaches tmux (step-1 diagnostic).
- Toggle open/close cycle: `tmux-sidebar-toggle` run twice opens then closes;
  options set/unset correctly; no orphan panes.
- All 5 tabs render: sessions (3 rows), windows (8 rows), agents (4 pi rows),
  filetree (`eza --tree` of content pane cwd), scratch (global + project
  buffers).
- Tab switching: `1`–`5` set `@sidebar_source`; `render_body` follows (verified
  via debug log: `set_source agents` → next `render_body` `src=agents`).
- Cursor movement: `j`/`k` move `sel`, clamped to `row_count`.
- Agent colorization: rose/pink/muted by state.
- `q` closes the sidebar and clears options.

## What's NOT yet verified interactively

- **`Enter` actions** (focus pane / open dir / open file) — tested via
  `send-keys Enter` but `switch-client` semantics can't be fully simulated
  from outside the attached client. The `focus_pane` helper is copied from
  `tmux-fzf-nav` (proven), so it should work, but confirm by pressing Enter on
  a row in a real session.
- **Filetree `Enter`-on-dir** opening a new pane in the right place — the path
  reconstruction is approximate (see Follow-up #3 in the reference doc).
- **Scratch `:wq` returning to the dispatcher** — the `exec bash -c "nvim $f;
  exec $SELF"` pattern is sound but not end-to-end tested.

## Known rough edges (refine these)

1. **Filetree `ft_paths` is the root for all rows.** The eza glyph stripping
   (`├── `/`└── `/`│   ` removal) doesn't reconstruct child paths correctly —
   all rows get `ft_root`. Rows *display* fine; only the `Enter` action's path
   is wrong. Fix: parse eza's indentation depth and join path segments
   properly, or switch to `find -print` + awk.
2. **Agent `wname` often empty for pi.** The agents-tab row format
   `wname · sname [agent]` shows `· m* [pi]` when `wname` is blank. Cosmetic;
   the `render_agents` function handles it (`loc` falls back to just `sname`).
3. **`trunc` strips ANSI.** Long rows are truncated to plain text (loses inline
   color past the cut point). Acceptable for nav rows; revisit if colored
   truncation is wanted.
4. **No `tsave` filter.** Sidebar panes restore as stale shells after a
   `tload`. The `@sidebar_pane` marker is set; the filter just needs adding to
   `tsave`'s pane walk.
5. **Stash-via-`break-pane` not implemented.** Close is kill (re-open
   re-launches the dispatcher). If re-open latency is noticeable, implement
   the tabby-style stash — but solve the AeroSpace tiling interaction first.

## Quick test recipe (for a refining agent)

```sh
# Clean any stale state
tmux list-panes -a -F '#{pane_id} #{pane_title}' | grep sidebar | \
  while read -r pid _; do tmux kill-pane -t "$pid"; done
for w in $(tmux list-windows -a -F '#{session_id}:#{window_index}'); do
  tmux set-option -wqu -t "$w" @sidebar_pane_id
  tmux set-option -wqu -t "$w" @sidebar_content_pane
  tmux set-option -wqu -t "$w" @sidebar_source
done

# Open + verify each tab
~/.config/tmux_scripts/tmux-sidebar-toggle
SP=$(tmux show-options -wqv @sidebar_pane_id)
for tab in 1 2 3 4 5; do
  tmux send-keys -t "$SP" "$tab"; sleep 1
  tmux capture-pane -p -t "$SP" -S -100 -E - | grep -vE '^$' | head -3
done

# Close
tmux send-keys -t "$SP" q
```

If a tab renders blank, check its data source directly
(`tmux-fzf-nav --list-sessions`, `tmux-agent-ls`, `eza --tree ...`) before
assuming the dispatcher is broken.

---

## Revision 2 session handoff (blocks architecture + bug-fix pass)

> Everything above this line is the original MVP session. This section covers
> a follow-up session that (a) fixed every item the original session flagged
> as "not yet verified" or "known rough edge", plus several more bugs found
> only by actually running the dispatcher live in tmux, and (b) redesigned
> the layout around a stacked-blocks model after reviewing
> [herdr](https://github.com/herdrdev/herdr) and
> [agent-manager](https://github.com/YoanWai/agent-manager) as references.
> `mm-sidebar.md` has been rewritten to describe the current state
> directly (not as a diff against the MVP); this section is the session log.

### What triggered this session

Three user-reported problems against the original MVP: the sidebar pane
didn't span the full window height (only the height of the pane it split
from), the dispatcher re-ran its full data-fetch pipeline on every keypress
("functionally unusable"), and filetree `Enter`-on-a-directory didn't create
a new pane at the right place. A screenshot also showed an empty `[]` agent
tag and a cramped, unspaced tab strip. Comparing against herdr's and
agent-manager's screenshots additionally surfaced that a large fraction of
the pane's vertical space sat empty on any low-row-count tab (sessions,
windows, scratch) — agent-manager fills exactly this dead space with a
persistent bottom-docked "computer" gauge panel below its session tree.

### Fixes, in the order they were found (all reproduced live in a real tmux
pane before and after, via a throwaway `sidebar_test` session)

1. **Full height.** `split-window -h -b -l 28` only spans the target pane's
   existing height. Added `-f` ("creates a new pane spanning the full window
   height... instead of splitting the active pane" — confirmed against the
   tmux man page, available since 3.2, this repo requires 3.7+). Verified by
   splitting a 3-pane window (one half-height target) and confirming the new
   sidebar pane's `pane_top`/`pane_height` matched the full window, not the
   half-height pane it was targeted at.
2. **Per-keystroke full refetch.** Split every tab's expensive data-gathering
   into a `fetch_*` function, gated by a `dirty` flag set only on tab switch,
   explicit `r`, the 2s poll timeout, or a structural change — never on plain
   `j`/`k`. Added a matching cheap `paint_*` that only prints cached
   `rows[]`/`actions[]`.
3. **Enter was a complete no-op, on every tab, root-caused as two independent
   bugs stacked on top of each other** (this took the most digging):
   - `read -rsn1` without `-d ''` stops early at a newline (documented `-n`
     behavior), so a real Enter keypress came back as an empty string —
     identical to the 2s timeout branch. Fixed by adding `-d ''` everywhere.
   - That alone wasn't enough: `k=$(read_key)` still swallowed it, because
     command substitution unconditionally strips trailing newlines from
     captured output, regardless of what the read itself captured. Diagnosed
     with an isolated `bash -uc` harness that read a raw Enter from a real
     pty and printed the captured byte with `%q` — showed `read` itself was
     fine (`$'\n'`) but `$(read_key)` still came back empty. Fixed by having
     `read_key` set a global `KEY` variable directly instead of `printf`ing
     for capture.
   - Confirmed fixed by pressing Enter on a real filetree directory row and
     watching `tmux list-panes` show the new pane at the exact selected path.
4. **Filetree path-reconstruction bug**, per the original Follow-up #3:
   replaced eza-tree-glyph-stripping with a `find -mindepth 1 -maxdepth 1`
   walker (root, then one more pass per subdirectory) that carries the real
   absolute path on every row natively — no reconstruction needed. This
   introduced a new bug caught only by running it live:
5. **bash 3.2 "unbound variable" crash.** macOS's stock `/bin/bash` is 3.2.57
   (confirmed via `bash --version`, and by the fact `declare -A` is
   unavailable). Expanding an empty array with `"${arr[@]}"` under `set -u`
   throws in 3.2 (fixed in 4.4+); `"${!arr[@]}"` (indices) does not have this
   problem. The filetree walker crashed the whole dispatcher pane outright
   the first time it hit a directory with zero subdirs or zero files at
   depth 2 (`line 257: d2[@]: unbound variable` — reproduced live, killed the
   pane). Fixed by guarding every such value-expansion with
   `[ "${#arr[@]}" -gt 0 ]` first. Verified against a synthetic
   `/tmp/ft_test` tree with an empty dir, a dirs-only dir, and a files-only
   dir, plus the real `~/.config` tree.
6. **Off-by-one that scrolled the header off-screen.** Once the filetree
   could emit far more rows than the pane is tall, emitting exactly
   `pane_height` newline-terminated lines was found to scroll the terminal
   by 1 to advance the cursor past the last row — silently shifting the
   whole frame up by one line, every render, so the tab-strip header was
   reliably missing from every capture. Reserved 1 row of headroom in the
   layout math to fix.
7. **tty-echo race under rapid keys**, found while stress-testing (3) by
   sending 40 keys in a tight burst — some landed as literal echoed text on
   screen. `read -n` only suppresses echo *during* each call; there's a
   narrow gap between consecutive calls where the tty's default echo can
   leak through. Fixed with a one-time `stty -echo -icanon min 1 time 0` at
   startup (restored on exit) instead of relying on bash's per-call
   save/restore.
8. **TSV field-collapse bug behind the `[]` empty agent tag.** Root-caused by
   piping `tmux-agent-ls`'s actual live output through the *exact* `read`
   line `render_agents`/`fetch_agents_glance` uses and printing each
   captured variable — showed `wname`/`agent` shifted left by one field.
   Traced to: bash's `read` with `IFS=$'\t'` still collapses *consecutive*
   delimiters (tab counts as "IFS whitespace" no matter what IFS is
   explicitly set to — confirmed with a minimal `printf 'a\tb\t\tc\td\n' |
   IFS=$'\t' read -r w x y z` repro showing the empty field vanishes
   entirely). The empty field was `transcript` (common: no discoverable
   session transcript). Fixed in both `tmux-claude-ls` and `tmux-agent-ls` by
   substituting `"-"` for a missing transcript, matching the existing `name`
   field's own placeholder convention, rather than changing the parsing
   approach.
9. **Redundant `tmux-claude-ls` field count.** Separately found while fixing
   (8): `tmux-claude-ls` itself emits 9 fields (ending in `statusUpdatedAt`,
   not an agent tag), but `tmux-agent-ls` was appending `"claude"` as a 10th
   field on top of that — a genuine schema mismatch against the 9-variable
   `read` in the sidebar (`sid pane target sname state name transcript wname
   agent`), which would have glued `statusUpdatedAt` and `"claude"` into one
   garbled last field. Fixed by dropping `statusUpdatedAt` and appending
   `"claude"` in its place instead of as an extra field, so Claude rows and
   pi rows share the same 9-field shape.

### Blocks architecture (after the above fixes)

Asked the user how to fill the "large fraction of the pane's vertical space
is empty on low-row-count tabs" gap, referencing agent-manager's persistent
bottom-docked "computer" panel. Answer: build a generic stackable-blocks
layout (not a hardcoded single extra panel), with a first implementation of
two blocks stacked. Result:

- Header (2 lines) → navigator (flexible, 4 tabs: sessions/windows/filetree/
  scratch — `agents` removed as a tab) → `agents_glance` (docked, read-only,
  urgency-sorted, capped+truncated) → `system_stats` (docked, read-only,
  cpu/mem/disk/battery, own 5s refresh timer) → done.
- `SIDEBAR_DOCK_BLOCKS=(agents_glance system_stats)` array config +
  `dock_fetch`/`dock_paint`/`dock_height` case-statement dispatch (not
  dynamic function names — bash 3.2 has neither associative arrays nor
  namerefs, both of which a generic "call `fetch_$id`" pattern would want).
- Degradation: sum every active block's `height_*`; if the navigator would
  drop below `NAV_MIN_HEIGHT` (3), drop the last block in the array (lowest
  priority: `system_stats` before `agents_glance`) and recompute, repeating
  until it fits or no blocks remain.
- `agents` became a read-only glance (no cursor, no Enter) rather than an
  interactive tab, since interactive agent switching already has a home:
  the existing `M-b` cross-session menu (`tmux-claude-menu`). This removed a
  genuine redundant interactive surface the old 5-tab model had, not just a
  side effect of finding somewhere to put the block.

### Verified live (this session, in a real tmux pane, not just static review)

- Full-height split across 3 different pre-existing pane layouts.
- Fetch/paint split: navigator fetch functions confirmed to *not* re-run on
  plain `j`/`k` (only on tab switch/`r`/2s timeout).
- Filetree: synthetic edge-case tree (empty dir / dirs-only / files-only) +
  the real `~/.config` tree, both via a standalone sourced-function harness
  and live in a real pane.
- Enter-on-directory: real end-to-end pane creation at the exact selected
  path, confirmed via `tmux list-panes`.
- Enter-on-file (scratch): nvim launches, `:q`/`:wq` correctly returns to a
  fresh dispatcher process on the same tab.
- Toggle close: pane killed, window-scoped options cleared, verified empty.
- Blocks layout at 3 pane heights: everything fits, partial degrade
  (system_stats dropped only), full degrade (both blocks dropped, navigator
  gets the whole pane) — all three confirmed via `tmux capture-pane`.
- `system_stats` numbers sanity-checked against `df -H /`, `vm_stat`, and
  `pmset -g batt` run directly alongside the dispatcher's own values.
- `tmux-agent-ls`/`tmux-claude-ls` field-collapse fix verified with a
  fabricated Claude session (fake `claude/sessions/<pid>.json`, fake pane,
  both with and without a discoverable transcript file) run through the
  real (edited) script end to end.

### Still open (carried forward, unchanged from the original MVP)

- Stash-via-`break-pane` instead of kill (Follow-up #1) — not implemented,
  AeroSpace tiling interaction still unsolved.
- `tsave` sidebar-pane filter (Follow-up #2) — `@sidebar_pane` marker is in
  place, filter itself not added.
- Per-window vs. single global sidebar (Follow-up #3, renumbered from #4) —
  unchanged, still per-window.


---

## Revision 3 session handoff (Go/Bubble Tea rewrite + rename + M-Tab focus-toggle)

> Everything above is the bash era. This revision replaced the dispatcher with a
> compiled Go/Bubble Tea binary, renamed the plugin `mega-michael-sidebar` →
> `mm-sidebar`, and changed `M-Tab` from open/close to a three-state focus
> toggle. `mm-sidebar.md` describes the current state directly; this section is
> the session log.

### Why

Revision 2 closed every item it had flagged, but the bug list it closed was
*entirely* bash/termios/subprocess-shaped (Enter no-op ×2, tty-echo race,
off-by-one frame scroll, bash-3.2 arrays, TSV field collapse). Two measurements
made the runtime the obvious thing to change rather than the next bug:

- `tmux-agent-ls` measured **1.26–1.44s** on a 20-pane machine, and the 2s poll
  set `dirty=1` unconditionally — so with a single-threaded blocking `read` key
  loop, a keypress landing inside a sweep waited for the whole sweep. Revision
  2's fetch/paint split fixed lag *between* polls and never touched this.
- `fg()` was a command substitution wrapping another one (2 forks per colored
  token) plus a `basename` fork per filetree row: a ~200-row filetree was ~800
  forks, re-run every 2s.

### Findings that corrected the existing docs

1. **The bash-3.2 premise was wrong.** `tmux-sidebar` is `#!/usr/bin/env bash` →
   Homebrew bash **5.3.15**. The `set -u` empty-array crash reproduces only under
   `/bin/bash` 3.2.57 (confirmed both ways). So the case-statement dock dispatch
   and the empty-array guards were defensive against a version that never ran,
   and bash 4+ features were avoided for no reason.
2. **`CLAUDE.md` is a symlink to `AGENTS.md`** — asked to diff them for extra
   context; there is none, same bytes.
3. **`df -H /` was reporting the wrong disk.** On APFS `/` is the sealed system
   volume: it reports **5%** here while `/System/Volumes/Data` reports **48%**.
   The bash `system_stats` block showed 5%. Not a rounding difference — fixed to
   measure the data volume with a `/` fallback.
4. **`tmux_scratch/` was documented as gitignored but wasn't** in either
   `.gitignore` or `.git/info/exclude`. Added.
5. **`show-hooks -g` does not list `window-layout-changed`.** With no argument it
   omits it entirely, so the hook looks unset; `show-hooks -g <name>` shows it.
   Nearly led to a wrong conclusion that the existing `refresh-active-bg` wiring
   was dead. It fires — verified by instrumenting it.

### What was built

- **`tmux_scripts/mm-sidebar/`** — Go module: `internal/tmuxio` (single batched
  `display-message -p` per tick; `#{@user_option}` resolves window-scoped options
  so no `show-options` forks), `internal/theme` (five `@color-*` roles →
  `lipgloss`), `internal/agents` (the join), `internal/nav` (4 tabs),
  `internal/blocks` (`Block` interface + 2 docked blocks), `model.go` (layout,
  keys, mouse, agent feed, fsnotify).
- **`tmux-sidebar-build`** — build-on-demand, temp-path + atomic rename, ~10ms
  no-op. **`tmux-sidebar-repin`** — width restoration. **`tmux-agent-ls`** — now
  a thin wrapper over `mm-sidebar agents`.
- **`tmux-sidebar-toggle`** — rewritten as the three-state focus toggle with the
  `mkdir`+pid lock and `$TMUX_PANE` sourcing.
- `tmux.conf`: `@color-canvas`, `prefix Tab` bind, two `[100]`-indexed hooks.
  `tsave`: `@sidebar_pane` filter. `.git/info/exclude`: binary + `tmux_scratch/`.

### Bugs found by actually running it (not static review)

1. **`tmux-fzf-nav`'s display column is space-padded for a wide fzf popup.**
   Rendered verbatim in 28 columns a row came out `float    2:conf          …`
   with the cwd truncated away entirely. Added `squeezeSpaces`; the *ordering*
   (float-first, creation order) is what had to stay consistent, not the padding.
2. **Agent rows didn't align and the urgent rows lost the most data.** The four
   state tags were 5/5/1/1 cells wide, so no two rows started their location in
   the same column; and `[claude]` spent 8 of 28 columns on the least actionable
   field, truncating the *location* on exactly the rows that need it. Fixed to a
   fixed-width 2-char tag (`!P`/`!W`/`~~`/blank) with the agent suffix dropped.
   (Asked the user rather than choosing unilaterally — three options priced out.)
3. **Inline `resize-pane` in a resize hook is silently discarded.** The width
   re-pin hook fired every time with the correct pane id and the sidebar still
   ended at **1 column** after 160→100. tmux applies its own proportional layout
   *after* the hook body returns. Fixed with `run-shell -b` into a script that
   also sweeps *all* windows (`client-resized` only resolves formats against the
   client's current window).
4. **`display-message -p '#{pane_id}'` is the wrong source for "which pane am I
   acting for"** — it resolves to the client's *active* pane. Switched the toggle
   to `$TMUX_PANE`, the same fix `AGENTS.md` already documents for
   `.nnn-preview-scroll`.

### Verified live (in a real tmux pane, not static review)

- Agent output **byte-identical** to the bash version (`diff`), all four states
  plus a no-transcript session. **1.44s → 0.09–0.20s** cold; `MMS_TRACE=1` over
  ~9s showed 5 resolves, only the first paying the `ps` sweep, the rest
  **13.6–15.7ms**.
- All 4 tabs render; tab switch, `j`/`k`, `g`/`G`, `?` overlay.
- **`Enter` on a nested filetree directory opens a pane at that exact path**
  (`tmux list-panes` confirmed) — the revision-2 bug, now fixed by construction.
- Scratch → nvim → `:q` → dispatcher, with the tab preserved and dock blocks live.
- Degradation at 3 heights; **rendered lines == `pane_height` at every size**, so
  the off-by-one/scroll class is gone rather than worked around.
- Wide glyphs: synthetic CJK tree, every rendered line ≤28 cells (measured in
  cells, not chars).
- Mouse click maps to the exact row (raw SGR injection); wheel moves the cursor.
- Three-state toggle over 4 presses: focus alternates, **pane count stays 2**.
  Two concurrent invocations → exactly one sidebar. `--close` clears
  `@sidebar_pane_id`/`@sidebar_content_pane`, keeps `@sidebar_source`, focuses the
  content pane.
- Width holds at 28 across five resizes (100/160/90/200/120), both hook indices
  intact.
- `tsave` excludes the sidebar pane; a regression run on the real sessions kept
  float-first order, 6 Claude session ids, and no field shift.

### Still open

- **`tmux_scripts/tmux-sidebar` (bash) retained** as the no-Go-toolchain
  fallback. Delete when that's judged unnecessary.
- Per-window vs. single global sidebar — unchanged, still per-window.
- `tload` doesn't re-open sidebars (by design now — `tsave` filters them).
- **Stash-via-`break-pane` is closed, not deferred** — the focus toggle means the
  pane isn't killed incidentally, which was its only justification.
- Three stale local artifacts this session could not remove (`rm` was denied by
  the permission mode) — delete by hand:
  - `tmux_scripts/mm-sidebar/mega-michael-sidebar` — the old-named binary. Note
    the `.git/info/exclude` entry only covers `mm-sidebar/mm-sidebar`, so this one
    *does* show up in `git status` until removed.
  - `~/.config/tmux_sessions/mms_filter_test.{json,md}` and
    `mms_regress.{json,md}` — throwaway `tsave` snapshots from testing the
    `@sidebar_pane` filter. (`tmux_sessions/` is gitignored, so these are only
    clutter.)
