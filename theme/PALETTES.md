# Palette construction guide

How a `theme/palettes/<name>.json` canonical palette is built from an upstream
colorscheme, and the quality floor every palette (including the two
hand-authored ones, `vague` and `oldworld`) must clear. `theme quality [name]`
enforces the contrast/distinctness rules mechanically; this document is the
semantic reasoning behind them, for whoever adds or re-curates a palette.

## Rejected: the old import heuristic

The 35 imported palettes were originally built by pooling every hex literal
out of an upstream colorscheme's Lua/VimScript source into one set, then
assigning each canonical role by ranking pooled literals on summed RGB
("brightest"), or on hue/chroma proximity to a guessed role. No perceptual
luminance, no foreground/background contrast, and no cross-check against the
upstream source's own semantic names (`bg`, `fg`, `comment`, `red`,
`bg_highlight`, ...) was performed. This produced systemic bugs: a single dim
gray literal reused for `text-muted`, `copy-mode-indicator`, `divider-subtle`,
and ANSI 8 regardless of whether it actually cleared 3:1 against any surface;
raw bright accent hex assigned to background-tint roles (`surface-heading-h1`,
`surface-tint-rose`) that render text on top of them; and outright
hue-mismatched surfaces (a red `surface-chrome`, a green `surface-highlight`)
from grabbing an accent/diagnostic literal instead of a background literal.
**Do not reintroduce this heuristic.** Every role must be sourced from the
upstream source's own semantic key for that concept, or (where the schema
needs a role upstream has no equivalent for) derived by the blend rule below
and then contrast-validated - never picked by brightness/chroma ranking alone.

## Semantic role mapping

Read the upstream source file at the pinned path (see Provenance below), not
a downstream re-export or a pooled literal list. Map by the upstream author's
own semantic names:

| Canonical role | Upstream concept to look for |
|---|---|
| `canvas` | primary editor background (`bg`, `bg0`, `background`) |
| `surface-active` | first background tier up from canvas (`bg1`, `bg_highlight`, `gray01`) - what an "active" surface should read as |
| `surface-chrome` | UI chrome background (status line, sidebar, popup bg) |
| `surface-highlight` | selection/visual-mode background |
| `divider-subtle` | usually equals `surface-chrome` unless upstream has a dedicated border color |
| `text` / `text-ui` / `text-default` | primary foreground (`fg`, `foreground`) |
| `text-muted` / `copy-mode-indicator` | comment color (`comment`, `gray06`-ish tier) - see the muted-family rule below |
| `accent-primary`..`accent-amber` | the 8 named hues (red/orange/yellow/green/cyan/blue/magenta + a highlight/bright variant), matched to upstream's own bright/normal split where one exists |
| `selection-bg` / `selection-fg` | upstream's own selection colors, if distinct from `surface-highlight`/`text` |
| `surface-heading-h1/h2/h3`, `surface-tint-rose` | usually **not present upstream** - see the blend rule |

A role is a **literal hex** taken from upstream, not a rank-ordered guess. If
two canonical roles legitimately share one upstream value (e.g. `divider-subtle`
and `surface-chrome` both reading the same UI-chrome background), that's fine;
the bug class this guide exists to prevent is an upstream value that does not
semantically belong to the role it was placed in.

## The muted/dim family must be genuinely legible, not one recycled literal

`text-muted`, `copy-mode-indicator`, ANSI 8, and (decoratively) `split-divider`
all read as "the dim gray." They are not required to be identical, and
`text-muted` should sit a little lighter than `copy-mode-indicator`/ANSI 8 so
the family reads as related-but-distinct (see `vague.json`: `text-muted
#656a80` vs `copy-mode-indicator #606079` - close, not equal). What is
required: `text-muted` and `copy-mode-indicator` must clear **3:1** contrast
against `canvas`, `surface-active`, and `surface-chrome` (they render as
informational text - Pi's `dim`/`muted`, k9s `comment`, tmux muted text, a
LazyGit inactive border label - not as decoration). If upstream's own comment
color doesn't clear that floor against this project's actual canvas, lighten
it in HSL space (same hue, same saturation, raise L) until it does; don't
substitute an unrelated hue. `divider-subtle` and plain `split-divider` framing
characters are decorative and are not held to this floor.

## Background-tint roles are dark blends, not raw accents

`surface-heading-h1`/`h2`/`h3` and `surface-tint-rose` are **backgrounds**
rendered under text: nvim render-markdown heading backgrounds and Pi's
success/error tool-card backgrounds. Upstream almost never defines these
directly. Derive them as a controlled blend of `canvas` toward the relevant
accent hue (h1←`accent-primary`, h2←`accent-secondary`, h3←`accent-amber`,
tint-rose←`accent-primary` at a lower ratio), starting around a 12-16% mix and
reducing it until both `text` on the blended background clears **4.5:1** and
`text-muted` on it clears **3:1**. The result must look like a dark tinted
card, not a foreground accent swatch - if the accent itself is very light/pale,
that means a lower blend ratio, not a brighter background.

## ANSI mapping

`ansi[0]` is `canvas`. `ansi[7]`/`ansi[15]` (normal/bright white) carry primary
terminal text in ANSI-inheriting tools (bat, btop, OpenCode, nnn) and must
clear **4.5:1** against canvas. `ansi[8]` (bright black) carries dim/comment
text in those same tools and must clear **3:1** against canvas - it is not
exempt just because it's conventionally "the dark one." `ansi[1..6]`/`ansi[9..14]`
follow the normal/bright pairs from upstream's own hue table where one exists.

## Contrast floors (enforced by `theme quality`)

- **4.5:1** - `text`/`text-ui`/`text-default` against `canvas`/`surface-active`/
  `surface-chrome`; `selection-fg` against `selection-bg`; `text` against every
  heading/tint background role; ANSI 7/15 against canvas.
- **3:1** - `text-muted`/`copy-mode-indicator` against `canvas`/`surface-active`/
  `surface-chrome`; `text-muted` against every heading/tint background role;
  ANSI 8 against canvas.
- **Distinctness** - `canvas` vs `surface-active` (so tmux's active-pane
  background swap is perceptible); `accent-primary`/`accent-secondary`/
  `accent-tertiary` pairwise (so the tmux pane-footer's outer/center/dash
  accents don't collapse into one color). The distinctness floor is
  deliberately low (see `theme.py`'s `DISTINCT_ACCENT`/`DISTINCT_SURFACE`) -
  it only needs to catch true duplicates/near-duplicates, not force maximal
  separation within a cohesive accent family like vague's own dusty-purple
  `accent-tertiary`/`accent-secondary` pairing.

## Variant handling

A named upstream variant (moon/soft/hard/brighter/...) must be built from that
variant's **own** table in the upstream source, not by copying the base
variant's palette and relabeling it. Check for accidental duplication: if two
palette JSONs that declare different `source.variant` values produce identical
`roles`/`ansi`, that's a bug (this project shipped exactly this bug for
`substrata` vs `substrata-brighter` - fixed by reading `M.brighter` instead of
reusing `M.default`).

## Provenance

Every imported palette's `source` object records `repository`, `path`, and
`variant` (see `schema.json`). Add `revision` (the commit SHA the values were
actually read from, e.g. via `git log --format=%H -1 -- <path>` or the GitHub
API) whenever a palette is (re)built from a live fetch, so the exact upstream
snapshot is reproducible. A palette without `revision` predates this
requirement; re-verify against upstream before trusting its exact hex fidelity
rather than assuming it's current. `vague` and `oldworld` have no `source` -
they are hand-authored originals, not imports.
