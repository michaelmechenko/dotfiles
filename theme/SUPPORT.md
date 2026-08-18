# Theme system — support matrix

One canonical semantic palette per colorscheme (`theme/palettes/<name>.json`), one
generator (`theme/theme.py`), deterministic per-theme bundles (`theme/bundles/<name>/`),
and a machine-local active pointer (`theme/active`, untracked symlink).

## Consumer classification

| Consumer | Class | Mechanism |
|---|---|---|
| Ghostty | generated adapter | `config-file` → `theme/active/ghostty/theme` (ANSI + UI colors) |
| tmux | generated adapter | `source-file` → `theme/active/tmux/colors.conf` (semantic `@color-*`) |
| mm-sidebar | semantic consumer | reads `@color-*` options at runtime; generated fallback |
| zsh / FZF / moor | generated adapter | `source` → `theme/active/shell/palette.sh` |
| Oh My Posh | generated adapter | `p:<role>` references + generated palette |
| Claude Code | generated adapter | `theme/active/claude/theme.json` (11 overrides on `dark-ansi`) |
| pi | generated adapter | `theme/active/pi/theme.json` (self-contained 51-token theme) |
| K9s | generated adapter | `theme/active/k9s/skin.yaml` |
| LazyGit | generated adapter | `theme/active/lazygit/colors.yml` |
| SketchyBar / JankyBorders | generated adapter | `theme/active/sketchybar/colors.sh` (ARGB forms) |
| Neovim | native-theme selector + overlay | palette declares `native.nvim`; shared chrome via `theme/active/nvim/palette.lua` |
| Zed | native-theme selector | palette declares `native.zed` |
| bat | ANSI-inheriting | `--theme=ansi` (inherits Ghostty ANSI) |
| btop | ANSI-inheriting | `TTY` theme (inherits Ghostty ANSI) |
| OpenCode | ANSI-inheriting | `system` theme (inherits Ghostty ANSI) |
| nnn | ANSI-inheriting | `NNN_COLORS`/`NNN_FCOLORS` are ANSI indices (constant) |

## Role set

Semantic, hue-independent roles (see `schema.json` for the contract). A role value is
a hex or an `@role` reference. The full set is enforced by `theme/theme.py`'s
`REQUIRED_ROLES`; the ANSI 0–15 array and the `native` section (Neovim/Zed names) are
explicit per palette.

## Wiring model

Tracked configs reference the stable `~/.config/theme/active/<artifact>` path. The
`theme switch` command builds the bundle, atomically repoints `theme/active`, and
applies the live stack. Switching never edits a tracked file, so it does not dirty git.
