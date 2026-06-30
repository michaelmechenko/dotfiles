#!/usr/bin/env bash

# Toggle SketchyBar between the full and performance profiles (file swap + flag only; does
# NOT reload — reloading is cmd-ctrl-alt-o's job, so the two actions are decoupled).
#   full        -> ~/.config/sketchybar/sketchybarrc.full        (all items + AeroSpace)
#   performance -> ~/.config/sketchybarrc.performance            (right block only, blur=0, display=main)
#
# The active config (~/.config/sketchybar/sketchybarrc) is a PLAIN FILE: toggling copies the
# chosen profile over it. (Copy, not symlink — sketchybar reloads a plain file unambiguously;
# symlink resolution on reload was unverified for this build.) The /tmp/sketchybar_perf_mode
# flag also gates the AeroSpace callbacks in aerospace.toml so they stay idle in perf mode.
#
# Echoes the new mode ("full" / "performance") on stdout for the Hammerspoon caller to alert.
set -euo pipefail

DIR="$HOME/.config/sketchybar"
FLAG="/tmp/sketchybar_perf_mode"
ACTIVE="$DIR/sketchybarrc"
FULL="$DIR/sketchybarrc.full"
PERF="$DIR/sketchybarrc.performance"

# Ensure both profiles exist and are executable (sketchybar executes the config directly).
[ -f "$FULL" ] || cp "$ACTIVE" "$FULL" 2>/dev/null || true
chmod +x "$FULL" "$PERF" 2>/dev/null || true

if [ -f "$FLAG" ]; then
  rm -f "$FLAG"
  rm -f "$ACTIVE"
  cp "$FULL" "$ACTIVE"
  echo "full"
else
  : > "$FLAG"
  rm -f "$ACTIVE"
  cp "$PERF" "$ACTIVE"
  echo "performance"
fi

chmod +x "$ACTIVE" 2>/dev/null || true
