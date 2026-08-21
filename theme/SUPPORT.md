# Theme system — support matrix

One canonical semantic palette per colorscheme (`theme/palettes/<name>.json`), one
generator (`theme/theme.py`), deterministic per-theme bundles (`theme/bundles/<name>/`),
and a machine-local active pointer (`theme/active`, untracked symlink). See
`theme/PALETTES.md` for how a palette's roles are constructed and the contrast/
distinctness floors every palette must clear.

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

## Terminal-only scope (desktop freeze)

`theme switch <name> --scope terminal` applies every terminal/CLI consumer (tmux,
generated Oh My Posh/LazyGit configs, the pi/Claude/K9s discovery links) but never
calls the SketchyBar or JankyBorders apply functions - no process is signaled,
killed, or relaunched, and no file under `sketchybar/`/`borders/` is touched.
Default scope (`--scope all`, or omitting the flag) is unchanged: it also restarts
SketchyBar and JankyBorders through their existing safe kill+relaunch lifecycle.

The SketchyBar adapter (`_sketchybar` in `theme.py`) only ever reads the four
`bar-*` roles (`bar-text`, `bar-canvas`, `bar-border-active`, `bar-border-inactive`),
never the shared terminal roles (`text-ui`, `surface-chrome`, ...). This means a
terminal-role contrast/legibility fix can never move the live desktop bar/border
output - `bar-border-active`/`bar-border-inactive` are frozen per-palette literals,
seeded once from whatever `text-ui`/`surface-chrome` resolved to before the
contrast repair (see `theme/PALETTES.md`). `theme/test_theme.py`'s
`DesktopFreezeTests` enforce both halves: the adapter never references the shared
roles, and `--scope terminal` never calls the desktop apply functions.

## Quality gate

`theme check <name>` and `theme quality [name]` run `check_quality()`: WCAG
contrast checks for every text/background pair a consumer actually renders
(normal text 4.5:1, muted/dim informational text 3:1, ANSI 7/8/15, selections,
Pi tool-card states) plus distinctness checks for the tmux pane-footer accents
and the canvas/active-surface pair. `theme quality` with no argument sweeps
every palette and exits non-zero on any unwaived finding. See `theme/PALETTES.md`
for the full rule set, the two hand-authored palettes' narrow documented
waivers (`theme.py`'s `QUALITY_WAIVERS`), and why the prior pooled-literal
import heuristic produced systemic legibility failures across the imported set.
