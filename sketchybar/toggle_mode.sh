#!/usr/bin/env bash

# Toggle SketchyBar between the full and performance profiles (file swap + flag only; does
# NOT reload — reloading is cmd-ctrl-alt-o's job, so the two actions are decoupled).
#   full        -> ~/.config/sketchybar/sketchybarrc.full        (all items + AeroSpace)
#   performance -> ~/.config/sketchybarrc.performance            (muted app/workspace blocks, blur=0)
#
# The active config (~/.config/sketchybar/sketchybarrc) is a PLAIN FILE: toggling copies the
# chosen profile over it. (Copy, not symlink — sketchybar reloads a plain file unambiguously;
# symlink resolution on reload was unverified for this build.) The /tmp/sketchybar_perf_mode
# flag suppresses focus-change callbacks in aerospace.toml; workspace-change callbacks remain
# so the muted app/workspace blocks refresh only when switching workspaces.
#
# Echoes the selected mode ("full" / "performance") on stdout for the Hammerspoon caller to alert.
# `--refresh` rewrites the bare active copy without flipping the current profile; theme
# changes use it after editing the tracked .full/.performance sources.
set -euo pipefail

DIR="$HOME/.config/sketchybar"
FLAG="/tmp/sketchybar_perf_mode"
ACTIVE="$DIR/sketchybarrc"
FULL="$DIR/sketchybarrc.full"
PERF="$DIR/sketchybarrc.performance"

# Ensure both profiles exist and are executable (sketchybar executes the config directly).
[ -f "$FULL" ] || cp "$ACTIVE" "$FULL" 2>/dev/null || true
chmod +x "$FULL" "$PERF" 2>/dev/null || true

copy_profile() {
  local source=$1 mode=$2
  rm -f "$ACTIVE"
  cp "$source" "$ACTIVE"
  chmod +x "$ACTIVE" 2>/dev/null || true
  echo "$mode"
}

case "${1:-toggle}" in
  --refresh)
    if [ -f "$FLAG" ]; then
      copy_profile "$PERF" performance
    else
      copy_profile "$FULL" full
    fi
    ;;
  toggle)
    if [ -f "$FLAG" ]; then
      rm -f "$FLAG"
      copy_profile "$FULL" full
    else
      : > "$FLAG"
      copy_profile "$PERF" performance
    fi
    ;;
  *)
    echo "usage: $0 [--refresh]" >&2
    exit 2
    ;;
esac
