# Color guide

Single source of truth for colors used across tmux, Ghostty, and zsh (via ohmyposh). Every hex below is currently in use in one of the three configs; the table also flags where they diverge.

## Roles

### Surfaces

| Role | Hex | Where used |
|---|---|---|
| `canvas` | `#100E11` | Ghostty `background`; tmux inactive pane, status bar, borders, message line, all window-status states; active pane when single-pane or zoomed |
| `surface-active` | `#151316` | tmux active pane bg + active border bg, only when window has 2+ panes and is not zoomed |
| `surface-chrome` | `#1C1C24` | nvim chrome: dropbar WinBar bg, lualine statusline/winbar bg |
| `surface-highlight` | `#2A2A35` | nvim `CursorLine` (override in `vague.lua`'s `on_highlights`) |
| `copy-mode-indicator` | `#606079` | tmux `copy-mode-position-style` block bg (top-right time/scroll box shown in copy mode); indicator text is `text-default` `#a9b1d6` |
| `divider-subtle` | `#383848` | nvim `SnacksIndent` + `NeoTreeIndentMarker` fg (indent guides); Claude statusline ` * ` separators |

### Text

| Role | Hex | Where used |
|---|---|---|
| `text` | `#BEBEBE` | Ghostty `foreground`; nvim editor fg (`vague.lua` `colors.fg`); nvim WinBar fg (`dropbar.lua`) |
| `text-muted` | `#656a80` | tmux `@color-inactive` — secondary UI text (border fg, status secondary text, bell-state); nvim devicons, dropbar `DropBarIconKindDefault`, lualine inactive-buffer fg; Claude statusline dir/model/ctx text; Claude theme `inactive` token |
| `text-default` | `#a9b1d6` | tmux `@color-default` — window-status text (the colored window names in the status bar). **Not referenced elsewhere.** |

### Accents

| Role | Hex | Where used |
|---|---|---|
| `accent-primary` (rose) | `#d8647e` | tmux `@color-rose`; tmux ephemeral session indicator + zoomed border center; Ghostty ANSI 1; ohmyposh path segment |
| `accent-secondary` (lavender) | `#aeaed1` | tmux `@color-ephemeral` / `@color-lavender2` / `@color-float`; tmux pane-border-active fg; Ghostty ANSI 6; ohmyposh session segment |
| `accent-tertiary` (dusty pink) | `#bb9dbd` | tmux `@color-dusty_pink`; Ghostty ANSI 2; ohmyposh transient prompt + git segment |
| `accent-highlight` (pale lavender) | `#bebedb` | tmux `@color-lavender` / `@color-active` — current window status |
| `accent-info` (slate) | `#8ba9c1` | Ghostty ANSI 12; ohmyposh executiontime segment. **No tmux usage.** |
| `accent-warn` (warm sand) | `#f5cb96` | Ghostty ANSI 11. **ohmyposh uses a near-miss variant** (see below). |
| `accent-amber` (amber) | `#f3be7c` | Ghostty ANSI 4; nvim `GitSignsChange`. Distinct from `accent-warn` (`#f5cb96`, ANSI 11) — `accent-amber` is more orange-ward. |

### Selection / chrome (Ghostty only)

| Role | Hex |
|---|---|
| `selection-bg` | `#252530` |
| `selection-fg` | `#cdcdcd` |
| `split-divider` | `#878787` |

## Cross-tool consistency

### Aligned (use the same hex in every place they appear)

- `#d8647e` rose — tmux `@color-rose`, Ghostty ANSI 1, ohmyposh path ✓
- `#aeaed1` lavender — tmux `@color-ephemeral`, Ghostty ANSI 6, ohmyposh session ✓
- `#bb9dbd` dusty pink — tmux `@color-dusty_pink`, Ghostty ANSI 2, ohmyposh transient + git ✓
- `#8ba9c1` slate — Ghostty ANSI 12, ohmyposh executiontime ✓

### Near-misses (different by one hex digit between tools — should be normalized)

| Conflict | Tmux | Ghostty | ohmyposh |
|---|---|---|---|
| Soft lavender used in zoomed-border stars | `#c9b1c9` (inline in pane-border-format) | `#c9b1ca` (ANSI 13) | n/a |
| Pale lavender (window-status / "bright cyan") | `#bebedb` (`@color-lavender`) | `#bebeda` (ANSI 14) | n/a |
| Warm sand (git icon / "bright yellow") | n/a | `#f5cb96` (ANSI 11) | `#F5CC96` (git icon template) |

Three places drift by one hex digit. The fixes are mechanical — pick one of the two values for each conflict and propagate.

### Recommended normalization (not yet applied)

- Lavender accent (`c9b1c9` vs `c9b1ca`): pick **`#c9b1ca`** (Ghostty's value, since the palette is the larger contract). Update the tmux pane-border-format on line 254 of `~/.config/.tmux.conf` to use `#c9b1ca`.
- Pale lavender (`bebedb` vs `bebeda`): pick **`#bebedb`** (tmux's value, since `@color-lavender` is referenced multiple times). Update Ghostty `~/.config/ghostty/themes/vague` ANSI 14 to `#bebedb`.
- Warm sand (`F5CC96` vs `f5cb96`): pick **`#f5cb96`** (Ghostty's value). Update `~/.config/ohmyposh/base.json` git template — both occurrences of `#F5CC96` become `#f5cb96`.

### Tmux-only colors (not in Ghostty's palette)

- `#a9b1d6` (`@color-default`) — closest Ghostty match is ANSI 12 (`#8ba9c1`), but they're notably different. Either accept that tmux has its own "default text" color outside the palette, or replace it with a palette-aligned hex. Currently no inconsistency *bug*, just an "outlier" worth noting.

## Claude Code integration

Claude Code uses a custom theme at `~/.config/claude/themes/vague-aligned.json`, activated via `"theme": "custom:vague-aligned"` in `settings.json`. The theme bases on `dark-ansi` (which binds Claude's UI to Ghostty's ANSI palette) and overrides 11 semantic tokens to lock them to palette values:

| Token | Hex | Palette role |
|---|---|---|
| `claude` | `#d8647e` | accent-primary |
| `text` | `#BEBEBE` | text |
| `inactive` | `#656a80` | text-muted |
| `success` | `#bb9dbd` | accent-tertiary |
| `error` | `#d8647e` | accent-primary |
| `warning` | `#f3be7c` | accent-amber |
| `planMode` | `#8ba9c1` | accent-info |
| `autoAccept` | `#aeaed1` | accent-secondary |
| `diffAdded` | `#bb9dbd` | accent-tertiary |
| `diffRemoved` | `#d8647e` | accent-primary |
| `promptBorder` | `#383848` | divider-subtle |

`promptBorder` is the input-box border (default permission mode). Note: message-background tokens (`userMessageBackground`, etc.) only render in fullscreen TUI mode — in default scrollback mode the submitted user message is un-themeable terminal dim styling (foreground `text` at ANSI faint ≈ `#5F5F5F`), so there is no background to recolor.

Other Claude tokens (subagent colors, fullscreen backgrounds, `bashBorder`, `ide`, `fastMode`, etc.) inherit from `dark-ansi` — i.e. they pick up Ghostty's ANSI palette, which is already palette-aligned for the slots in active use.

The statusline script at `~/.config/claude/statusline-command.sh` uses six colors: `text-muted` (dir/model/ctx), `divider-subtle` (separators), and four accent roles (`accent-tertiary` branch + added, `accent-amber` modified, `accent-primary` deleted).

## Git colors (cross-tool)

| Operation | Hex | Used in |
|---|---|---|
| Branch indicator | `#bb9dbd` (`accent-tertiary`) | Claude statusline `color_branch`; ohmyposh `git.foreground` |
| Added (+ / diffAdded) | `#bb9dbd` (`accent-tertiary`) | nvim `GitSignsAdd`; Claude statusline `color_add`; Claude theme `success` + `diffAdded` |
| Changed (~) | `#f3be7c` (`accent-amber`) | nvim `GitSignsChange`; Claude statusline `color_dirty`; Claude theme `warning` |
| Deleted (− / diffRemoved) | `#d8647e` (`accent-primary`) | nvim `GitSignsDelete`; Claude statusline `color_delete`; Claude theme `error` + `diffRemoved` |
| Git icon decoration | `#f5cb96` (`accent-warn`) | ohmyposh git template surround |

## How to add new colors

1. Pick a role from the table above if one fits; if not, add a new role.
2. Reference via the tmux user-option pattern (`set -g @color-<name> "#…"` then `#{@color-<name>}`) if the color is reused. Inline hex is acceptable for one-off uses (like the zoomed-border center stars).
3. If the new color is meant to be available shell-wide (so command output and ohmyposh can use it), add it to `~/.config/ghostty/themes/vague` as one of the ANSI slots.
4. Update this file.
