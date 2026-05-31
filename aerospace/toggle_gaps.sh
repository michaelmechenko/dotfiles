#!/usr/bin/env bash

set -euo pipefail

CFG="$HOME/.config/aerospace/aerospace.toml"

# Toggle the outer gaps between the 16-state (default) and the 64-state.
# Top scales with the side gaps while preserving the SketchyBar clearance
# (built-in = side - 2, external = side + 22). Inner gaps are untouched.
CUR="$(grep -E '^[[:space:]]*outer\.left[[:space:]]*=' "$CFG" | grep -oE '[0-9]+' | head -1)"

if [ "$CUR" = "64" ]; then
  L=16; TB=14; TE=38
else
  L=64; TB=62; TE=86
fi

sed -i '' -E \
  -e "s|^([[:space:]]*outer\.left[[:space:]]*=[[:space:]]*).*|\1${L}|" \
  -e "s|^([[:space:]]*outer\.bottom[[:space:]]*=[[:space:]]*).*|\1${L}|" \
  -e "s|^([[:space:]]*outer\.right[[:space:]]*=[[:space:]]*).*|\1${L}|" \
  -e "s|^([[:space:]]*outer\.top[[:space:]]*=[[:space:]]*).*|\1[ {monitor.\"Built-*\" = ${TB}}, ${TE} ]|" \
  "$CFG"

aerospace reload-config
