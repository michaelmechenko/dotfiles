# mega-michael-sidebar — session handoff

> Written at the end of the implementation session. A refining agent should
> read this alongside `mega-michael-sidebar.md` (the stable reference) to
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
   truth section), this handoff, and `mega-michael-sidebar.md` (reference).

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
> `mega-michael-sidebar.md` has been rewritten to describe the current state
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

