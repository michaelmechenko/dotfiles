# Keybinds

Reference for all active keybinds across AeroSpace (`aerospace/aerospace.toml`), Hammerspoon (`hammerspoon/init.lua`), tmux (`tmux.conf`), and pi. Modifier order: `cmd` > `ctrl` > `alt` > `shift`.

## Pi

| Key / command | Action |
| --- | --- |
| `shift-tab` | Cycle thinking level forward (Pi built-in) |
| `ctrl-tab` | Cycle thinking level backward (`thinking-controls/`; Ghostty maps it to F13) |
| `ctrl+r` | Rename the current live pi session (`session-rename/`) |
| `ctrl+.` | Open the unanswered-question form (`answer/`) |
| `alt+enter` / `shift+enter` / `ctrl+j` | Insert a newline in the Pi editor |
| `ctrl+enter` | Send the current message as a follow-up |
| `ctrl+e` | Open the extension-toggle picker |
| `ctrl+shift+e` | Open the skill-toggle picker |
| `ctrl+s` | Stash or restore the Pi prompt |
| `ctrl+shift+o` | Toggle extension-owned multiline tool-call detail |
| `ctrl+l` / `ctrl+shift+p` | Open the model selector |
| `ctrl+shift+s` | Save inside the scoped-models picker |
| `ctrl+shift+r` | Toggle sorting inside the session picker |
| `home` / `cmd-left` | Move to the start of the current editor line |
| `end` / `cmd-right` | Move to the end of the current editor line |
| `ctrl+p` | Cycle plan-mode access: none → plan → read-only → none; an idle execution pauses and re-enters plan mode |
| `ctrl+alt+p` / `ctrl+alt+t` | Toggle the plan execution progress widget |
| `/plan` / `/plan-review` | Enter structured planning or review a ready plan; execution opens the destination/model wizard |
| `tab` / `right` and `shift-tab` / `left` | In the plan-mode execution wizard, cycle the selected multi-value setting forward/backward with wraparound; `enter` / `space` also advance it |
| `ctrl+v` | In the plan-mode TUI recalibration editor, attach a clipboard image or paste clipboard text when no image is available |
| `ctrl+g` | In the plan-mode TUI recalibration editor, open the configured external editor |
| `/read-only` / `/mode` | Enter standalone read-only mode / cycle the three plan-mode access states |
| `/rename [name]` | Rename the current live pi session; omit `name` to open a prompt |

## AeroSpace — main mode

### Layout & gaps
| Key | Action |
| --- | --- |
| `cmd-/` | Cycle layout: accordion → horizontal → vertical |
| `cmd-shift-/` | Cycle layout: tiles → horizontal → vertical |
| `cmd-shift-s` | Toggle focused window floating ↔ tiling (keeps on-screen frame; Hammerspoon `toggleFloatKeepPos`) |
| `cmd-shift-v` | Toggle outer monitor gaps 16 ↔ 64 (inner gaps unchanged; `toggle_gaps.sh`) |
| `cmd-shift-0` | Balance window sizes |

### Fullscreen
| Key | Action |
| --- | --- |
| `cmd-shift-f` | Toggle fullscreen (refreshes bar for border tint + brackets) |
| `cmd-m` | Toggle fullscreen (same as above) |

### Focus
| Key | Action |
| --- | --- |
| `cmd-h` | Focus left (wrap workspace, ignore floating) |
| `cmd-j` | Focus down (wrap workspace) |
| `cmd-k` | Focus up (wrap workspace) |
| `cmd-l` | Focus right (wrap workspace, ignore floating) |
| `cmd-\`` | Cycle window/workspace forward (`cycle_workspace_window.sh next`) |
| `cmd-shift-\`` | Cycle window/workspace backward (`cycle_workspace_window.sh prev`) |
| `cmd-;` | Cycle window/workspace backward (same as `cmd-shift-\``) |
| `cmd-'` | Cycle window/workspace forward (same as `cmd-\``) |

### Move
| Key | Action |
| --- | --- |
| `cmd-shift-h` | Move focused window left |
| `cmd-shift-j` | Move focused window down |
| `cmd-shift-k` | Move focused window up |
| `cmd-shift-l` | Move focused window right |
| `cmd-shift-w` | Move focused window to next monitor + focus-follows-window (then Hammerspoon debounced snap `almostMaximizeAfterMove`) |

### Join (container nesting)
| Key | Action |
| --- | --- |
| `cmd-ctrl-shift-h` | Join with nearest window to the left |
| `cmd-ctrl-shift-j` | Join with nearest window below |
| `cmd-ctrl-shift-k` | Join with nearest window above |
| `cmd-ctrl-shift-l` | Join with nearest window to the right |

### Resize
| Key | Action |
| --- | --- |
| `cmd-shift-minus` | Resize smart −50 |
| `cmd-shift-equal` | Resize smart +50 |
| `cmd-ctrl-minus` | Resize smart −325 |
| `cmd-ctrl-equal` | Resize smart +325 |
| `cmd-shift-up` | Resize height +50 |
| `cmd-shift-down` | Resize height −50 |
| `cmd-shift-left` | Resize width −50 |
| `cmd-shift-right` | Resize width +50 |

### Workspaces — switch (keyswap-aware)
`cmd-N` / `cmd-shift-N` roles swap via `cmd-shift-b`. **Default:** `cmd-N` → workspace, `cmd-shift-N` → window.

| Key | Action |
| --- | --- |
| `cmd-1` … `cmd-5` | Switch to workspace `N*` (main monitor). `cmd-2` falls back to `1^` when `2*` is empty. |
| `cmd-shift-1` … `cmd-shift-6` | Switch to window `N` (`focus_workspace_window.sh`) |
| `cmd-alt-1` | Switch to workspace `1^` (secondary monitor) |
| `cmd-alt-2` | Switch to workspace `2^` (secondary monitor) |

### Workspaces — cycle
| Key | Action |
| --- | --- |
| `cmd-shift-a` | Move focused window to previous workspace (`move_workspace_cycle.sh prev`) |
| `cmd-shift-d` | Move focused window to next workspace (`move_workspace_cycle.sh next`) |
| `cmd-shift-;` | Cycle workspace backward (`cycle_workspace.sh prev`) |
| `cmd-shift-'` | Cycle workspace forward (`cycle_workspace.sh next`) |

### Workspaces — move focused window to
| Key | Action |
| --- | --- |
| `cmd-ctrl-1` … `cmd-ctrl-5` | Move to `N*` + focus-follows-window + Hammerspoon `almostMaximize()` |
| `cmd-shift-ctrl-1` | Move to `1^` + focus-follows-window + `almostMaximize()` |
| `cmd-shift-ctrl-2` | Move to `2^` + focus-follows-window + `almostMaximize()` |

### Toggles & modes
| Key | Action |
| --- | --- |
| `cmd-shift-b` | Toggle `cmd-N` ↔ `cmd-shift-N` roles (workspace ↔ window); refreshes bar indicator (`toggle_keyswap.sh`) |
| `cmd-shift-m` | Almost-maximize every window on focused workspace (Hammerspoon `almostMaximizeFocusedWorkspace`) |
| `cmd-shift-n` | Enter **move** mode |
| `cmd-shift-enter` | Enter **service** mode |
| `cmd-w` | Close focused window |

## AeroSpace — move mode
Entered via `cmd-shift-n`. All keys return to main mode after.

| Key | Action |
| --- | --- |
| `1` … `5` | Move focused window to `N*` + focus-follows-window |
| `shift-1` | Move focused window to `1^` |
| `shift-2` | Move focused window to `2^` |
| `m` | Move **all** windows to `1*`, focus `1*`, Hammerspoon `almostMaximizeAll()` |
| `esc` | Return to main mode (no-op) |

## AeroSpace — service mode
Entered via `cmd-shift-enter`. All keys return to main mode after.

| Key | Action |
| --- | --- |
| `esc` | Flatten workspace tree (reset layout) |
| `r` | Reload AeroSpace config |
| `f` | Toggle floating ↔ tiling layout |
| `cmd-shift-h` | Join with left |
| `cmd-shift-j` | Join with down |
| `cmd-shift-k` | Join with up |
| `cmd-shift-l` | Join with right |

## Hammerspoon — window sizing (`window.lua`)
All `cmd-ctrl-alt-*` (bound in `init.lua`). Frames computed directly, no Rectangle.

| Key | Action |
| --- | --- |
| `cmd-ctrl-alt-c` | Almost-maximize every window on focused workspace (display-wide fallback when AeroSpace is off) |
| `cmd-ctrl-alt-x` | Almost-maximize focused window (big-gap inset) |
| `cmd-ctrl-alt-b` | Center focused window at 4:3, smaller than `x` (`scale=0.8` knob) |
| `cmd-ctrl-alt-v` | Maximize focused window (small-gap inset; bar stays visible) |
| `cmd-ctrl-alt-shift-v` | Full maximize — same left/right as `v`, top inset = bottom so window covers the SketchyBar strip |
| `cmd-ctrl-alt-space` | Center focused window (no resize) |

## Hammerspoon — window drag (`drag.lua`)
Not a `hs.hotkey.bind` — a global mouse eventtap, active as long as Hammerspoon is running.

| Key | Action |
| --- | --- |
| `cmd-ctrl` + left-click-drag | Move the window under the cursor (any app, not just Ghostty) |

Added because `ghostty/config`'s `window-decoration = false` removes all native titlebar/frame drag handles. Only verified against a floating window; AeroSpace derives tiled window position from the layout tree, so dragging a tiled window is expected to get reverted on the next layout event (use `cmd-shift-s` / `toggleFloatKeepPos` to float first if that happens) — not independently confirmed in this session.

## Hammerspoon — bar & system (`bar.lua`)
All `cmd-ctrl-alt-*` (bound in `init.lua`).

| Key | Action |
| --- | --- |
| `cmd-ctrl-alt-p` | Toggle SketchyBar profile full ↔ performance (swap + flag only; **does not reload**) |
| `cmd-ctrl-alt-o` | Reload SketchyBar from disk (sole reload path) |
| `cmd-ctrl-alt-shift-o` | Toggle AeroSpace server on/off |
| `cmd-ctrl-alt-shift-b` | Toggle only the `borders` daemon (`borders.lua`); SketchyBar and AeroSpace stay running |

## Notes
- **Keyswap (`cmd-shift-b`):** swaps the roles of `cmd-N` (workspace) and `cmd-shift-N` (window). The SketchyBar `keyswap` item shows `*` while the swap is active. Default state: no flag, `cmd-N` = workspace.
- **Cross-monitor snap:** `cmd-shift-w` uses the debounced `almostMaximizeAfterMove` because the Accessibility API can report the old screen for a few ms after a monitor move.
- **Display-wide fallback:** `cmd-ctrl-alt-c` and `cmd-shift-m` auto-detect AeroSpace state — when the server is off, they snap all visible windows on the focused display instead of querying workspaces.
- **AeroSpace reload:** `prefix r` (= `C-Space r`) in normal use, or service mode `r` (`cmd-shift-enter` → `r`).

## tmux

Prefix is `C-Space`. Root-level binds (`bind-key -n`, no prefix) are marked **root**; prefix binds need `C-Space` first. `M-` = `Alt`. Every listed uppercase-letter root action also has an internal `M-S-<letter>` compatibility alias for terminals that report physical Alt+Shift explicitly; it is the same gesture/action, not a separate user binding. Lowercase Meta bindings have no alias; sidebar focus remains the special `M-BTab`. `~/.config/tmux_scripts/*` are launchers/helpers executed via `run-shell` (not tmux plugins).

### Core
| Key | Scope | Action |
| --- | --- | --- |
| `prefix r` | — | Reload `tmux.conf` |
| `prefix c` | — | New window in pane's cwd |
| `prefix t` | — | Prompt for per-pane border label (shows in bottom border whether the pane is active or inactive; empty clears) |

### Copy mode (vi keys)
Entered via `M-u`/`M-U` or mouse scroll. `setw -g mode-keys vi`.

| Key | Scope | Action |
| --- | --- | --- |
| `v` | copy-mode | Begin selection |
| `V` | copy-mode | Select line |
| `y` | copy-mode | Copy selection → `pbcopy`, exit |
| `MouseDragEnd1Pane` | copy-mode | Copy → `pbcopy`; cancel if at live bottom, else stay in copy mode |
| `S` | copy-mode | flash.nvim-style jump (`tmux-flash-jump.py`) — see below |

#### `S` — flash jump (`tmux-flash-jump.py`)
Type a query; every matching substring in the popup's visible content rows gets a single-key label (closest to the cursor gets the easiest/home-row label). The popup's bottom row is the search prompt, so it is not a target row. Press a label, or `Enter` for the nearest match, to move the copy-mode cursor there — a jump, not a copy. Normal copy-mode operations (`v`, `y`, more movement) continue from the new position. Labels replace the first cell of their match, preserving alignment for adjacent matches.

| Key | Action |
| --- | --- |
| *(typing)* | Narrow the search incrementally |
| *(label key)* | Jump to that match |
| `Enter` | Jump to the nearest match (by line distance from the current cursor) |
| `Ctrl-U` | Clear the query |
| `Ctrl-W` | Clear the last word of the query |
| `Esc` / `Ctrl-C` | Cancel — cursor unchanged |

### Pane — scroll / line numbers
| Key | Scope | Action |
| --- | --- | --- |
| `M-U` | root | Enter copy mode **with** hybrid line numbers (per-pane override; torn down on exit) |
| `M-u` | root | Scroll up 10 lines (enters copy mode, auto-exits at live bottom) |
| `M-n` | root | Scroll down 10 lines (auto-exits at live bottom) |

### Pane — focus / split / resize
| Key | Scope | Action |
| --- | --- | --- |
| `prefix h/j/k/l` | — | Select pane left/down/up/right |
| `M-h/j/k/l` | root | Select pane left/down/up/right |
| `M-J` | root | Split window vertical, in pane cwd |
| `M-L` | root | Split window horizontal `-l 50%`, in pane cwd |
| `M-W` | root | Resize pane up |
| `M-S` | root | Resize pane down |
| `M-A` | root | Resize pane left |
| `M-D` | root | Resize pane right |
| `M-z` | root | Zoom pane (`resize-pane -Z`) |
| `M-x` | root | Kill pane (confirm) |
| `M-X` | root | Kill window (double confirm) |
| `M-Up` | root | Resize pane up |
| `M-Down` | root | Resize pane down |
| `M-Right` | root | Forward raw key (zsh Alt+Right word-jump). Popup layout cycling disabled — see below. |
| `M-Left` | root | Forward raw key (zsh Alt+Left word-jump). Popup layout cycling disabled — see below. |

### Pane — move / break / send
| Key | Scope | Action |
| --- | --- | --- |
| `M-q` | root | Break pane into new window (`tmux-break-pane`) |
| `prefix q` | — | Break pane into new window (same) |
| `M-E` | root | Send pane to next window (`tmux-send-pane-adjacent next`; applies main-vertical if dest has panes) |
| `M-Q` | root | Send pane to prev window (`tmux-send-pane-adjacent prev`) |
| `M-i` | root | Send pane to a new window (`tmux-pane-to-window`) |
| `M-I` | root | Send pane's window to a new session (`tmux-window-to-session`) |
| `prefix ;` | — | Move active pane to the nearest column on the left |
| `prefix '` | — | Move active pane to the nearest column on the right |
| `M-<` | root | Swap pane up |
| `M->` | root | Swap pane down |

### Window
| Key | Scope | Action |
| --- | --- | --- |
| `M-e` | root | New window in pane cwd |
| `M-w` | root | Current-session pane picker fzf popup (`tmux-window-ls`) |
| `M-;` | root | Previous window |
| `M-'` | root | Next window |
| `M-1` … `M-9` | root | Select window 1–9 |
| `M-,` | root | Swap window to −1 |
| `M-.` | root | Swap window to +1 |
| `prefix W` | — | Rename window (prompt) |
| `prefix w` | — | Window list popup (`tmux-window-ls`) |

### Layouts
| Key | Scope | Action |
| --- | --- | --- |
| `M-V` | root | `even-vertical` layout |
| `M-H` | root | Cycle previous preset layout (`previous-layout`; 7 presets, wraps) |
| `M-v` | root | `tiled` layout |

### Session / float / popup
| Key | Scope | Action |
| --- | --- | --- |
| `M-f` | root | Floating terminal popup (`tmuxpopup`) |
| `M-F` | root | Switch to/from `float` session |
| `M-c` | root | Ephemeral terminal popup (`tmuxpopup-ephemeral`) |
| `prefix a` | — | From inside an ephemeral popup, join this pane back into the window it was spawned from (`tmux-ephemeral-attach`; no-op outside an ephemeral session) |
| `prefix f` | — | New window in `float` session from pane cwd, then popup |
| `prefix C` | — | New session (prompt) |
| `M-C` | root | New session (prompt) |
| `M-s` | root | Session picker fzf popup (`tmux-session-ls`) |
| `M-Tab` | root | Toggle persistent mm-sidebar mode: enable and ensure current; disable and close all (`tmux-sidebar-toggle`; see tmux sidebar section) |
| `M-BTab` | root | Switch focus to / from the mm-sidebar without closing it (`--focus`) |
| `prefix Tab` | prefix | Same persistent-mode toggle, terminal-agnostic fallback for `M-Tab` |
| `prefix BTab` | prefix | Same focus switch, terminal-agnostic fallback for `M-BTab` |
| `M-:` | root | Switch client to prev session (by index) |
| `M-[` | root | Switch client to prev session |
| `M-"` | root | Switch client to next session (by index) |
| `M-]` | root | Switch client to next session |
| `prefix S` | — | Rename session (prompt) |

### Popup layout cycle (disabled)
`tmux_scripts/tmux-popup-resize` still implements a 5-layout cycle (fullscreen/top/bottom/left/right), but `M-Right`/`M-Left` are currently unbound from it — reopening a popup with new geometry right after `detach-client` reliably races tmux's own popup teardown and makes the popup vanish instead of resizing (confirmed live against a real tmux server; the same bug pre-dates this work, in the old maximize/restore/`M-m` toggle). See `AGENTS.md`.

### Rename / status-left
| Key | Scope | Action |
| --- | --- | --- |
| `M-t` | root | Rename pane (prompt; sets pane title + `@pane-named`) |
| `M-R` | root | Rename session (prompt) |
| `M-r` | root | Rename window (prompt) |
| `M-N` | root | Toggle status-left directory mode (shows cwd + hides window list) |
| `M-T` | root | Other-panes fzf popup (`tmux-other-panes-ls`) |

### Mouse
| Key | Scope | Action |
| --- | --- | --- |
| `MouseDown1StatusRight` | root | Session chooser on status-right click (`tmux-status-session-ls`; backgrounded — tmux 3.7 segfault workaround) |
| `MouseDown3StatusRight` | root | Pane chooser on status-right right-click (`tmux-status-pane-ls`; backgrounded) |
| `MouseDown3Pane` | root | Pane context menu (open-in-finder, history top/bottom, paste, copy word/line/link, splits, swap, kill, respawn, mark, zoom) |
| `M-MouseDown3Pane` | root | Force pane context menu (even when app has mouse focus) |

## tmux — plugins & integrations (via `tmux_scripts/`)
Root-level launch keys; each opens an fzf/popup whose in-tool keys are listed under it. **All fzf surfaces share the standard fzf keys** (`C-j`/`C-k` and `M-j`/`M-k` navigate, `tab`/`btab` move, `C-d`/`C-u` and `M-n`/`M-u` preview scroll, `M-q` abort, `enter` accept, `esc` abort) — only menu-specific binds are called out below.

### `M-w` — window picker (`tmux-window-ls`)
Current-session pane list in an fzf popup (one row per pane), with compact fixed columns (`WINDOW`, `CMD`, `CWD`). Preview shows the pane from the bottom (recent output first) while keeping captured line breaks.
- **enter** — focus selected pane
- **ctrl-r** — reload pane list
- **ctrl-g / alt-g** — ripgrep over pane history in the **current session**, then jump to selected match pane
- **M-g** — same as `alt-g` (enter ripgrep mode)
- **M-w** — toggle close/open (press again to close active popup)

### `M-s` — session picker (`tmux-session-ls`)
Cross-session picker in an fzf popup (float-first session ordering, then creation order) with fixed columns and visible `SESSION` labels. Preview shows the selected session's active pane content.
- **enter** — switch to selected session/window/pane
- **ctrl-r** — reload session list
- **ctrl-g / alt-g** — ripgrep over pane history in **all sessions**, then jump to selected match pane
- **M-g** — same as `alt-g` (enter ripgrep mode)
- **M-s** — toggle close/open (press again to close active popup)

### `M-T` — other-panes picker (`tmux-other-panes-ls`)
Lists panes outside the current session in an fzf popup with fixed columns (including `SESSION`) and live pane preview.
- **enter** — focus selected pane
- **ctrl-r** — reload pane list
- **ctrl-g / alt-g** — ripgrep over pane history in **other sessions**, then jump to selected match pane
- **M-g** — same as `alt-g` (enter ripgrep mode)
- **M-T** — toggle close/open (press again to close active popup)

### `M-o` — target picker (`tmux-open-picker`)
One vertical fuzzy list over the visible origin pane. Every row is tagged **URL**, **FILE**, or **DIR**; selection resolves through an opaque ID, never rendered text. Paths are validated against [pane cwd, git root, parent directories]; paths containing `/` try all roots, bare filenames only the pane cwd, and punctuation wrappers such as `(src/main.rs)` are trimmed. The origin pane is explicit (`'#{pane_id}'`); M-o has no global `TMUX_OPEN_PANE` state.
- **type** — unrestricted fuzzy query; all printable keys, including `q/c/h/j/k/l`, remain searchable
- **Enter** — smart-open: URL → browser; FILE → nvim at its optional line; DIR → Finder
- **Ctrl-Y** — copy any selected target
- **Ctrl-F** — reveal a selected file or open a selected directory in Finder
- **Ctrl-N** — open a selected file or directory in nvim
- **M-o / Alt-Q / Esc** — close the active picker
- No candidates, stale panes, unsupported actions, and adapter failures show a concise tmux message and return nonzero.

### `M-K` — extrakto (`tmux-extrakto-launch`)
Extract words/lines/URLs from pane content (default grab area = window full) into fzf. Records the origin pane in `TMUX_OPEN_PANE`; `@extrakto_open_tool` routes ctrl-o opens through the shared `tmux-open-target` (files → nvim split, else `open`). Keeps `FZF_DEFAULT_OPTS` palette (`@extrakto_fzf_unset_default_opts "false"`).
- **ctrl-o** — open selected via `tmux-open-target` (files → nvim split, else `open`)
- **extrakto's built-in grab keys** — grab word/line, etc. (see extrakto docs)
- **M-j/M-k** — navigate up/down
- **M-q / M-K** — close

### `M-b` — Claude Code session menu (`tmux-claude-menu`)
Cross-tmux fzf menu of every Claude session, color-coded by state (permission/waiting = rose, thinking = dusty_pink, idle = inactive). **Rows are sorted actionable-first** (permission → waiting → thinking → idle) with a **relative activity age** per row (e.g. `2m`, `1h`). Preview shows prev response → your last message → latest response (+ plan excerpt if any), bat-highlighted.
- **enter** — focus that session's pane (across any tmux session)
- **k** — approve **all** waiting/permission sessions (send Enter to each)
- **ctrl-y** — approve the **selected** session (send Enter to its pane)
- **ctrl-s** — send a typed message to the selected session (`msg>` prompt in the popup)
- **ctrl-x** — kill the selected session's pane (**destructive**)
- **esc / M-b** — close

### `M-G` — Claude Code last response (`tmux-claude-last-response`)
Opens the current pane's Claude session's last assistant text response in an nvim split (always to the right; placement via `tmux-claude-open-split`). Errors with a tmux message if no Claude session / transcript in this pane.

### `M-P` — Claude Code plan / pi last response (`tmux-M-P-dispatch`)
Dispatches based on the current pane: if it's a live Claude Code session, opens its plan file (`claude/plans/*.md`, same as before — subagent plans `…-agent-<hash>.md` filtered out). Otherwise falls back to `tmux-pi-last-response`, which opens the pane's pi session's last assistant response instead. Both open in an nvim split, right-side placement via `tmux-claude-open-split`. Errors with a tmux message if neither applies.

### `prefix .` — Claude Code next permission (`tmux-claude-next-permission`)
Cycle to the next Claude session needing user input (awaiting-permission / waiting), sorted ascending by target; wraps to the first. Switches client + selects the pane. Errors with a tmux message if none need input.

### `M-g` — lazygit popup (`tmux-lazygit-popup`)
Full-screen `tmux popup` running `lazygit` in the pane's cwd. Border uses `@color-inactive`.

### `M-p` — scratch prompt editor (`tmux-pi-prompt`)
Opens an empty scratch buffer in an nvim split directly underneath the triggering pane (horizontal split). Not tool-specific — works for any pane that accepts pasted text (pi, Claude Code, opencode, a shell). Write and quit (`:wq` / `ZZ`) to paste the buffer's contents back into the pane that triggered `M-p`, as a single bracketed paste (populates the prompt/input — does not submit). Quit without writing (`:q` / `:cq`), or leave the buffer empty, and nothing is sent back.

## tmux — nnn file explorer (`tmux-nnn-explorer`)
nnn in a tmux popup; in-nnn plugins (pressed as `;<key>`) spawn splits back in the **origin window** via `NNN_ORIGIN_PANE`. Toggle: pressing the launch key from inside the explorer closes it. **Standard nnn keys apply throughout** (arrows/`h`/`j`/`k`/`l` navigate, `enter` opens, `/` search, `q` quit, etc.) — only the custom `;`-prefixed plugin keys are listed below.

| Key | Action |
| --- | --- |
| `M-d` | Centred float popup (65% × 75%), start in origin pane cwd; panes stack top/bottom below 160 columns and sit side-by-side at 160+ (preview remains 70%) |
| `M-B` | Overlay the launching pane (fills it instead of floating) |

In-nnn plugin keys (`;` prefix — nnn requires it for plugins):
| Key | Action |
| --- | --- |
| `;l` | Horizontal split (open selected in origin window) |
| `;j` | Vertical split (open selected in origin window) |
| `;e` | New window in origin session (dir → shell there / file → nvim) |
| `;i` | Send `cd` to the origin pane's prompt |
| `;w` | Toggle preview word-wrap (moor `w`; less `-S`) |
| `;p` | Toggle file preview (bat/moor, `ansi` theme, 70% preview width) |
| `;f` | fzcd — fuzzy-jump to a subdir (`M-g` jumps into `;g`/fzrg; standard fzf keys + `M-j`/`M-k`/`M-u`/`M-n`/`M-q` apply) |
| `;g` | fzrg — live ripgrep (syntax + match highlight) → open match in an nvim split in the origin window |
| `;h` | Keybind cheatsheet popup (nnn native basics + this launch's `;`-plugin keys, read live from `$NNN_PLUG` + the M-* keys meaningful inside `;f`/`;g`). nnn's own native `?` still shows its full compiled-in help/about screen. |

## tmux — sidebar (`tmux-sidebar-toggle` / `mm-sidebar`)

> Internal plugin name: **mm-sidebar**. Canonical reference:
> `tmux_scripts/mm-sidebar.md`. This section is the keybind summary;
> the plugin doc has the full architecture, state, and gotchas.

A leftmost, full-window-height pane toggled by `M-Tab` (normal width 36; `w` cycles window-local 30/36/44 presets). Runs a compiled Go/Bubble Tea TUI (`tmux_scripts/mm-sidebar`, built on demand by `tmux-sidebar-build`) inside the pane — not fzf, not nnn. Renders a stack of blocks: a 2-line header, a flexible 5-tab **navigator** (sessions / panes / projects / filetree / scratch), and fixed-height **docked blocks** below it (`agents_glance`, `system_stats`) that stay visible regardless of which navigator tab is active — inspired by [agent-manager](https://github.com/YoanWai/agent-manager)'s session-tree-plus-persistent-gauges layout. Window-scoped state (`@sidebar_pane_id` / `@sidebar_content_pane` / `@sidebar_source`) so each window remembers its own tab.

**Persistent mode + focus switch.** `M-Tab` toggles the global desired state
`@sidebar_persistent`: enabling opens the current window without moving focus,
then selected windows/sessions get their own synchronized sidebar; disabling
closes every owner transactionally. `M-BTab` remains a window-local focus switch:

| Key | State | Result |
| --- | --- | --- |
| `M-Tab` | persistence off | enable it and ensure the current window's sidebar (`split-window -h -f -b -d -l 36`) — **focus does not move** |
| `M-Tab` | persistence on | disable it and close every sidebar, restoring each owner's geometry/zoom |
| `M-BTab` | no sidebar in this window | open it **and** focus it (local, even with persistent mode off) |
| `M-BTab` | open, sidebar not active | focus the sidebar and retarget it at the pane you came from |
| `M-BTab` | open, sidebar active | focus the window's **last active pane** — **sidebar stays open** |

Each sidebar is a separate window-owned pane; none is moved between windows.
`M-BTab` remains the cheap local peek/return gesture.

The return target is tmux's own last-pane, not the sidebar's content pane; those
differ once focus has bounced between content panes.

| Key | Scope | Action |
| --- | --- | --- |
| `M-Tab` | root | Toggle persistent mode: enable+ensure selected window, or disable+close all. Guarded like `M-j`/`M-q`: forwards raw inside any popup or the `nnn` session |
| `M-BTab` | root | Focus switch (three states above), pane stays alive. Same popup/nnn guard |
| `prefix Tab` | prefix | Identical persistent-mode toggle, reachable from **any** terminal. The `M-` forms only arrive via Ghostty's `alt+tab=csi:9;3u` / `alt+shift+tab=csi:9;4u` mappings, so the prefix table is the fallback over SSH / other emulators |
| `prefix BTab` | prefix | Identical focus switch, same fallback rationale |

`q`/`Esc` outside a sidebar modal/filter disable persistent mode and close every
sidebar. `tmux-sidebar-toggle --close` remains the local, unbound failure/script
cleanup path.

**Inside the sidebar pane** (pane must be focused; docked blocks have no *keys* of their own — glances, not pickers — though they can accept a mouse click):

| Key | Action |
| --- | --- |
| `1` … `5` | Switch to sessions / panes / projects / filetree / scratch tab (`1`..`N` over the `nav.Sources` registry) |
| `Tab` / `S-Tab` | Cycle tabs forward / back |
| `j` / `↓` | Move down within the active focus region; wraps inside that region |
| `k` / `↑` | Move up within the active focus region; wraps inside that region |
| `J` / `ctrl-tab` (`F13`) | Rotate forward through visible non-empty focus regions without acting |
| `K` / `ctrl-shift-tab` (`F14`) | Rotate backward through visible non-empty focus regions without acting |
| `g` / `G` | Jump to the first / last actionable row across the sidebar |
| `Enter` | Act on the focused navigator row or actionable block row (tab/block-specific) |
| `/` | Enter the inline filter; typing and bracketed paste search the active tab without reordering its rows |
| `Backspace` | Delete one query character while filtering; otherwise invoke the active source's optional control (filetree: up one level) |
| `h` / `p` / `R` | Filetree only: toggle hidden entries / pin its root / reset and unpin root to the content cwd |
| `r` | Force refetch + re-render; on projects, manually re-read Git worktree metadata (never polled between changes) |
| `w` | Cycle this window's sidebar width: compact 30 → normal 36 → wide 44 |
| `a` / `:` | Open the selected navigator or actionable-block row's action palette; destructive actions require `y`/Enter confirmation |
| `?` | Toggle compact action-derived help overlay |
| `d` | Open cached diagnostics/help: World/fingerprint, source/root/filter/watch/visibility, refresh/error counters, IDs; no extra fork |
| `q` | Outside the filter, disable persistent mode and close every sidebar; type `q` into the query while filtering |
| `Esc` | Clear and exit the filter first; otherwise perform the same global dismissal as `q` |
| click (navigator) | Select the clicked navigator row |
| click (agents row) | **Switch to that agent's pane**, across sessions included. The `▸ agents` label, the `+N more` counter and `(none)` are inert |
| `a` / `:` on selected agent | Focus, open its existing response/plan view, or copy its stable session ID |
| wheel | Scroll the navigator viewport, **clamped** (no wrap) and only while the pointer is **over the navigator** — a wheel event over the docked blocks or the header does nothing |

Focus regions are the navigator and every visible non-empty `Navigable` block. Region rotation preserves each region's selected row and skips informational or degraded-away blocks. `system_stats`, labels, `(none)`, and `+N more` remain non-focusable. `M-b` remains the full agent picker.

Ghostty transports Ctrl-Tab/Ctrl-Shift-Tab as F13/F14; only mm-sidebar interprets those names, so Ctrl-Tab retains its Pi/zsh behavior elsewhere. Pane rows put `@pane-label` first (`label · index:window`) and include it in filtering. Session/pane alert badges are informational: `!` bell, `~` silence, `*` activity; they ride the existing World snapshot and never focus a row. Agent-glance state tags: `!P` awaiting permission, `!W` waiting, `~~` thinking, blank = idle (color also encodes state). Hovering an actionable agent row underlines its location only; hover neither changes keyboard focus nor activates it.

**Per-tab `Enter` actions + extra keys:**

| Tab | Source | `Enter` action | Extra keys |
| --- | --- | --- | --- |
| sessions | `tmux-fzf-nav --list-sessions` | `switch-client` + `select-pane` to that session's active pane | — |
| windows | `tmux-fzf-nav --list-windows` | `switch-client` + `select-pane` to that pane (current session only) | — |
| projects | persistent pinned/recent Git catalog observed from live pane cwds | focus a live worktree pane, else split at its root | `a`/`:` heading: pin/unpin; confirmed forget only when non-live; no recurring Git polling |
| filetree | `find`-based 2-level tree over the content pane's cwd | dir → `split-window -h -c <dir>` in the content pane; file → `tmux-open-target` (nvim split) | `h` hidden, `p` pin, `R` reset/unpin, `Backspace` up |
| scratch | `~/.config/tmux_scratch/{global,<slug>}.md` | `exec nvim <file>`; `:wq` returns to the dispatcher loop | — |

The `a`/`:` palette is descriptor-driven by the selected row: panes offer focus, label, rename window, zoom, on-demand preview, and confirmed kill; sessions offer focus, rename, and confirmed kill; project headings offer pin/unpin and confirmed forget only when not live; files/directories offer open, parent/split or new window, copy path, and Finder reveal. Preview captures only after selection, sanitizes captured ANSI/control bytes, and renders an exact-height 36-column-safe modal; it is never polled. Confirmed destructive tmux actions revalidate pane/session identity immediately before execution.

`agents` is not a navigator tab — it's the `agents_glance` docked block instead (always visible below the navigator, regardless of tab). Its visible rows are keyboard- and mouse-actionable, colorized by state (rose `#d8647e` for awaiting-permission/waiting, dusty_pink `#bb9dbd` for thinking, inactive `#656a80` for idle — same roles as the `M-b` menu), capped/urgency-sorted with a `+N more` row when clipped, and hover-underlined at their location only. Its selected-row palette reuses the existing response/plan dispatchers and can copy the stable session ID; it does not duplicate the agent join or automatic approval. Bulk actions stay on the `M-b` menu. The `system_stats` docked block shows a cpu/mem/disk glance, refreshed on its own ~5s timer (battery was dropped in revision 5 — it is already on the macOS menu bar and in SketchyBar).
