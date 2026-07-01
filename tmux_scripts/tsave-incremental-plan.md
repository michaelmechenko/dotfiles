# tsave incremental — design spec

## Goal

Maintain a live snapshot of every tmux session/window/pane, updating incrementally on structural changes and (optionally) cwd/title changes, so `tsave` can produce a JSON/MD snapshot without re-scanning everything.

## What tmux gives you for free

| Event | Hook | Available |
| --- | --- | --- |
| New window | `after-new-window` | yes |
| Pane split | `after-split-window` | yes |
| Pane closed | `pane-exited` / `pane-died` | yes |
| Session created | `session-created` | yes |
| Session closed | `session-closed` | yes |
| Session renamed | `session-renamed` | yes |
| Window renamed | `window-renamed` | yes |
| Layout changed | `window-layout-changed` | yes |
| Pane cwd changed | — | **no hook** |
| Pane title changed | — | **no hook** |
| Pane command changed | — | **no hook** |

tmux has no hook for cwd/title/command changes — these are polled attributes discovered by inspecting the process tree.

## Architecture

### Two layers

1. **Structural changes** (hook-driven, cheap): wire 6-8 `set-hook` entries to a debounced update script. Each hook fires `run-shell -b` through a coalescing lock (same pattern as `frontapps.sh`). Covers new/closed windows/panes, renames, layout changes.

2. **Cwd/title changes** (poll-driven, optional): a periodic `run-shell` timer (every 5-10s) or a background loop. Single `tmux list-panes -a` call, diff against last known state, only patch changed panes. Skip Claude session detection unless pid changed (the expensive part of `tsave`).

### State file

One flat TSV at `~/.config/tmux_sessions/.live.tsv` (gitignored via `.git/info/exclude`), updated in place. `tsave` reads it as a starting point; `tload` ignores it.

No JSON patching — the incremental mechanism maintains the TSV. `tsave` still produces JSON/MD on demand via the existing `jq` pipeline.

## Implementation

### `.tmux.conf` hooks

```
set-hook -g after-new-window      'run-shell -b ~/.config/tmux_scripts/tsave-incremental'
set-hook -g after-split-window    'run-shell -b ~/.config/tmux_scripts/tsave-incremental'
set-hook -g pane-exited           'run-shell -b ~/.config/tmux_scripts/tsave-incremental'
set-hook -g session-closed        'run-shell -b ~/.config/tmux_scripts/tsave-incremental'
set-hook -g window-renamed        'run-shell -b ~/.config/tmux_scripts/tsave-incremental'
set-hook -g session-renamed       'run-shell -b ~/.config/tmux_scripts/tsave-incremental'
set-hook -g window-layout-changed 'run-shell -b ~/.config/tmux_scripts/tsave-incremental'
```

### `tmux_scripts/tsave-incremental`

~30 lines:

1. `mkdir` atomic lock (coalesce concurrent hook fires, same pattern as `frontapps.sh`)
2. `tmux list-panes -a -F '#{pane_id}\t#{pane_current_path}\t#{pane_title}\t#{pane_current_command}\t#{session_name}\t#{window_index}\t#{window_name}\t#{pane_index}\t#{window_layout}\t#{pane_pid}' > .live.tsv.new`
3. `diff .live.tsv .live.tsv.new` — if same, exit
4. `mv .live.tsv.new .live.tsv`
5. (optionally) trigger `tsave` if auto-save is enabled

### `tsave` (modified)

- If `.live.tsv` exists and is recent, use it as input instead of `list-panes`
- Still do Claude session detection (the expensive part, but only on explicit save)

## Tradeoffs

- **Lightweight**: the incremental script is ~30 lines (lock + list-panes + diff + mv). Hooks are fire-and-forget.
- **No JSON patching**: live state stays as TSV; `tsave` still produces JSON/MD on demand.
- **Cwd gap**: without a poll loop, cwd changes won't be captured until the next structural event fires. Adding a 5s poll loop closes this but adds a persistent background process.
- **Hook fanout**: a single user action (e.g., closing a window) fires multiple hooks (`pane-exited` × N + `window-layout-changed`). The coalescing lock handles this.
- **tmux reload gotcha**: `source-file` won't unset deleted hooks. Adding `set-hook -gu` cleanup or accepting a restart is needed (same as existing `refresh-active-bg` hooks).

## Open question

Cwd poll loop (5-10s background, captures cd changes in real-time) vs hook-only (captures structural changes instantly, cwd changes on next structural event or explicit `tsave`)?
