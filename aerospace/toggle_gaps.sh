#!/usr/bin/env bash

set -euo pipefail

CFG="$HOME/.config/aerospace/aerospace.toml"

# --- tunables: per-side gaps for each toggle state ---
# small: tight, clears SketchyBar at top.
SMALL_LR=16; SMALL_B=16; SMALL_INNER=12; SMALL_TOP_BUILTIN=14; SMALL_TOP_EXT=38
# big: matches Rectangle Pro almost-maximize on the 2560x1440 external (measured
# L=52 R=52 T=74 B=53; centered with menu-bar clearance). Built-in top is unmeasured
# (laptop not connected) — keeps the external-minus-24 relationship; revisit on built-in.
BIG_LR=52;  BIG_B=52;  BIG_INNER=16;   BIG_TOP_BUILTIN=50;   BIG_TOP_EXT=74
# -----------------------------------------------------

CUR="$(grep -E '^[[:space:]]*outer\.left[[:space:]]*=' "$CFG" | grep -oE '[0-9]+' | head -1)"
if [ "$CUR" = "$BIG_LR" ]; then   # currently big -> go small
  LR=$SMALL_LR; B=$SMALL_B; I=$SMALL_INNER; TB=$SMALL_TOP_BUILTIN; TE=$SMALL_TOP_EXT
else
  LR=$BIG_LR;   B=$BIG_B;   I=$BIG_INNER;   TB=$BIG_TOP_BUILTIN;   TE=$BIG_TOP_EXT
fi

sed -i '' -E \
  -e "s|^([[:space:]]*inner\.horizontal[[:space:]]*=[[:space:]]*).*|\1${I}|" \
  -e "s|^([[:space:]]*inner\.vertical[[:space:]]*=[[:space:]]*).*|\1${I}|" \
  -e "s|^([[:space:]]*outer\.left[[:space:]]*=[[:space:]]*).*|\1${LR}|" \
  -e "s|^([[:space:]]*outer\.right[[:space:]]*=[[:space:]]*).*|\1${LR}|" \
  -e "s|^([[:space:]]*outer\.bottom[[:space:]]*=[[:space:]]*).*|\1${B}|" \
  -e "s|^([[:space:]]*outer\.top[[:space:]]*=[[:space:]]*).*|\1[ {monitor.\"Built-*\" = ${TB}}, ${TE} ]|" \
  "$CFG"

aerospace reload-config
