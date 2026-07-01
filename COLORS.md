# Color guide

Single source of truth for colors used across tmux, Ghostty, and zsh (via ohmyposh). Every hex below is currently in use in one of the three configs; the table also flags where they diverge.

## Roles

### Surfaces

| Role | Hex | Where used |
|---|---|---|
| `canvas` | `#100E11` | Ghostty `background`; tmux inactive pane, status bar, borders, message line, all window-status states; active pane when single-pane or zoomed; tmux `message-style`/`message-command-style` `fill=` (required on next-3.7 so the command-prompt repaints the full line — see Cross-tool notes) |
| `surface-active` | `#16141a` | tmux active pane bg (the `refresh-active-bg` alias's 2+-pane branch), only when window has 2+ panes and is not zoomed. Active border bg stays `canvas` `#100E11`. |
| `surface-chrome` | `#1C1C24` | nvim chrome: dropbar WinBar bg, lualine statusline/winbar bg (the whole bar — sections `b`/`c`/`x`/`y` + inactive — in the inline lualine theme; see `nvim lualine statusline`) |
| `surface-highlight` | `#2A2A35` | nvim `CursorLine` (override in `vague.lua`'s `on_highlights`) |
| `surface-extend` | `#d8647e` | nvim `NonText` fg/bold — `listchars` `extends`/`precedes` indicators (`»`/`«`) when line exceeds window width. Uses `accent-primary` rose. **Side-effect override:** groups that inherit `NonText` but should remain dim are reset to `copy-mode-indicator` `#606079`: `BlinkCmpGhostText`, `LspInlayHint`, `GitSignsCurrentLineBlame`, `ComplHint`. |
| `surface-fold` | `#8ba9c1` | nvim `FoldColumn` fg — fold markers (`▸`/`▾`/`│`) in the sign column. Uses `accent-info` slate blue. |
| `surface-heading-h1` | `#352f37` | nvim render-md H1 heading bg + underline fg (via `bg_as_fg`). Faint dusty pink tint at ~20% on canvas. Uses `accent-tertiary` hue. |
| `surface-heading-h2` | `#33333a` | nvim render-md H2 heading bg + underline fg. Faint lavender tint at ~20% on canvas. Uses `accent-secondary` hue. |
| `surface-heading-h3` | `#40362a` | nvim render-md H3 heading bg + underline fg. Faint amber tint at ~20% on canvas. Uses `accent-amber` hue. |
| `copy-mode-indicator` | `#606079` | tmux `copy-mode-position-style` block bg (top-right time/scroll box shown in copy mode); indicator text is `text-default` `#a9b1d6`. Also Ghostty ANSI 14 override (`ghostty/config`) — deliberately dims Claude Code's hardcoded session-rename label, which has no theme token (see Claude Code integration notes). |
| `divider-subtle` | `#383848` | nvim `SnacksIndent` + `NeoTreeIndentMarker` fg (indent guides); Claude statusline ` * ` separators |

### Text

| Role | Hex | Where used |
|---|---|---|
| `text` | `#BEBEBE` | Ghostty `foreground`; nvim editor fg (`vague.lua` `colors.fg`) |
| `text-ui` | `#9094A0` | nvim WinBar fg (`dropbar.lua`) — slightly dimmer than `text` for chrome/breadcrumb text |
| `text-muted` | `#656a80` | tmux `@color-inactive` — secondary UI text (border fg, status secondary text, bell-state); tmux copy-mode non-current line numbers (`copy-mode-line-number-style`, dim); nvim devicons, dropbar `DropBarIconKindDefault`, lualine inactive-buffer fg; nvim `FloatBorder` fg; Claude statusline dir/model/ctx text; Claude theme `inactive` token |
| `text-default` | `#a9b1d6` | tmux `@color-default` — window-status text (the colored window names in the status bar). **Not referenced elsewhere.** |

### Accents

| Role | Hex | Where used |
|---|---|---|
| `accent-primary` (rose) | `#d8647e` | tmux `@color-rose`; tmux ephemeral session indicator + zoomed border center; Ghostty ANSI 1; ohmyposh path segment; nvim lualine `replace`-mode status/location block |
| `accent-secondary` (lavender) | `#aeaed1` | tmux `@color-ephemeral` / `@color-lavender2` / `@color-float`; tmux pane-border-active fg; Ghostty ANSI 6 + ANSI 12 (ANSI 12 override → Claude Code code-block syntax highlighting, since its dark-ansi theme has no syntax token); ohmyposh session segment; nvim lualine `normal`/`command`-mode status/location block |
| `accent-tertiary` (dusty pink) | `#bb9dbd` | tmux `@color-dusty_pink`; Ghostty ANSI 2; ohmyposh transient prompt + git segment; nvim lualine `visual`-mode status/location block |
| `accent-highlight` (pale lavender) | `#bebedb` | tmux `@color-lavender` / `@color-active` — current window status; tmux copy-mode current line number (`copy-mode-current-line-number-style`, bold) |
| `accent-info` (slate) | `#8ba9c1` | ohmyposh executiontime segment; nvim `FoldColumn` fg (`surface-fold`); Claude theme `planMode` token. **No tmux usage. No longer Ghostty ANSI 12** — that slot was remapped to `accent-secondary` lavender (`#aeaed1`). |
| `accent-periwinkle` | `#9b9bcc` | nvim render-md inline code (`RenderMarkdownCodeInline` fg, bg cleared — fenced blocks keep their bg) + table borders (`RenderMarkdownTableHead` / `RenderMarkdownTableRow` fg; Head otherwise default-links to `@markup.heading` = blue `c.keyword`). A blue-violet between `accent-info` slate and `accent-secondary` lavender. **nvim-only.** |
| `accent-warn` (warm sand) | `#f5cb96` | Ghostty ANSI 11. **ohmyposh uses a near-miss variant** (see below). |
| `accent-amber` (amber) | `#f3be7c` | Ghostty ANSI 4; nvim `GitSignsChange`; nvim lualine `insert`-mode status/location block. Distinct from `accent-warn` (`#f5cb96`, ANSI 11) — `accent-amber` is more orange-ward. |

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
- `#8ba9c1` slate — ohmyposh executiontime, nvim `FoldColumn`, Claude `planMode` ✓ (Ghostty ANSI 12 was remapped away to `#aeaed1` lavender)
- `#aeaed1` lavender — tmux `@color-ephemeral`, Ghostty ANSI 6 + ANSI 12, ohmyposh session ✓

### Near-misses (different by one hex digit between tools — should be normalized)

| Conflict | Tmux | Ghostty | ohmyposh |
|---|---|---|---|
| Soft lavender used in zoomed-border stars | `#c9b1c9` (inline in pane-border-format) | `#c9b1ca` (ANSI 13) | n/a |
| Warm sand (git icon / "bright yellow") | n/a | `#f5cb96` (ANSI 11) | `#F5CC96` (git icon template) |

Two places drift by one hex digit. The fixes are mechanical — pick one of the two values for each conflict and propagate.

> Ghostty ANSI 14 ("bright cyan") was formerly a pale-lavender near-miss (`#bebeda` vs tmux's `#bebedb`). It is now **deliberately diverged** to `#606079` in `ghostty/config` to dim Claude Code's hardcoded session-rename label (Claude Code has no theme token for it). tmux's pale-lavender `accent-highlight` is a literal `#bebedb` and is unaffected.

### Recommended normalization (not yet applied)

- Lavender accent (`c9b1c9` vs `c9b1ca`): pick **`#c9b1ca`** (Ghostty's value, since the palette is the larger contract). Update the tmux pane-border-format on line 254 of `~/.config/.tmux.conf` to use `#c9b1ca`.
- Warm sand (`F5CC96` vs `f5cb96`): pick **`#f5cb96`** (Ghostty's value). Update `~/.config/ohmyposh/base.json` git template — both occurrences of `#F5CC96` become `#f5cb96`.

### Tmux-only colors (not in Ghostty's palette)

- `#a9b1d6` (`@color-default`) — closest Ghostty match was ANSI 12 (formerly `#8ba9c1`, now remapped to `#aeaed1`), but they're notably different. Either accept that tmux has its own "default text" color outside the palette, or replace it with a palette-aligned hex. Currently no inconsistency *bug*, just an "outlier" worth noting.

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

## nvim lualine statusline

The lualine theme is defined **inline** in `nvim/lua/plugins/lualine.lua` (`vague_lualine` table + `mode()` helper), set via `options.theme`. This replaces the theme vague.nvim used to ship at `lua/lualine/themes/vague.lua`, which upstream removed (commit `f911602`) — without it, lualine's `theme = 'auto'` silently fell back to its default theme. Owning it here keeps the statusline immune to upstream churn.

Lualine's section→color mapping is fixed: `lualine_a` + `lualine_z` use `.a`, `lualine_b` + `lualine_y` use `.b`, `lualine_c` + `lualine_x` use `.c`. So "location" (`z`) always matches "status" (`a`).

- **Whole bar bg** (`b`/`c`/`x`/`y`, all modes) = `surface-chrome` `#1C1C24`; their fg = `text` `#BEBEBE`.
- **Status/location block** (`a`/`z`) fg = `canvas` `#100E11` (dark text on the accent), bold; bg is the per-mode accent:
  - normal / command → `accent-secondary` `#aeaed1`
  - insert → `accent-amber` `#f3be7c`
  - visual → `accent-tertiary` `#bb9dbd`
  - replace → `accent-primary` `#d8647e`
- **Inactive** (`a`/`b`/`c`) = bg `#1C1C24`, fg `text-muted` `#656a80`.

Per-component overrides in the same file (the `buffers_color` block, the zero-width `#1c1c24` spacer in `lualine_b`, and the `filetype_spacing` extension) pin buffers to `#1c1c24` so they don't inherit the mode accent — consistent with the theme bg.

## nnn preview (bat)

`M-d` nnn previews (including `;f`/`fzcd` and `;g`/`fzrg`) and tmux fzf previews use bat with `--theme=ansi` (`NNN_BATTHEME=ansi`). This keeps syntax colors aligned with the active terminal palette instead of pinning a separate TextMate theme.

## fzf

`FZF_DEFAULT_OPTS` in `~/.config/.zshrc` sets a `--color` scheme matching the palette (applies to all fzf: fzcd, tmux-fzf-url, fzf-tab, shell). Mapping:

- `fg` `#656a80` (`text-muted` gray — unselected rows) · `fg+` `#bebebe` (`text` — selected row text, normal brightness) · `query` `#bebedb` (`accent-highlight`, typed text) · `bg`/`bg+`/`gutter`/`preview-bg` `-1` (all transparent)
- Selection indicated by `▌` pointer in `#d8647e` (`accent-primary` rose) on the left; selected row text is `text` `#bebebe`. No full-row bg tint.
- Match hierarchy: `hl` `#bb9dbd` (`accent-tertiary` dusty pink — matches on unselected rows) · `hl+` `#d8647e:bold` (`accent-primary` rose bold — matches on the selected row)
- `border`/`separator`/`scrollbar`/`preview-border`/`preview-scrollbar` `#383848` (`divider-subtle`)
- `prompt` `#aeaed1` (`accent-secondary`) · `marker` `#bb9dbd` (`accent-tertiary`) · `spinner` `#f3be7c` (`accent-amber`) · `info` `#656a80` (`text-muted` — the preview scroll-position "N/M" indicator)
- `header`/`disabled`/`label` `#656a80` (`text-muted`)

Note: `~/.config/.zshrc` is the tracked source of truth; the live `~/.zshrc` is synced manually (they have diverged — see future persona/work-profile split).

## How to add new colors

1. Pick a role from the table above if one fits; if not, add a new role.
2. Reference via the tmux user-option pattern (`set -g @color-<name> "#…"` then `#{@color-<name>}`) if the color is reused. Inline hex is acceptable for one-off uses (like the zoomed-border center stars).
3. If the new color is meant to be available shell-wide (so command output and ohmyposh can use it), add it to `~/.config/ghostty/themes/vague` as one of the ANSI slots.
4. Update this file.
