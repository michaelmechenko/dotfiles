#!/usr/bin/env bash

# Show the swap indicator only while the cmd / cmd-shift role swap is active.
if [ -f /tmp/aerospace_keyswap ]; then
  sketchybar --set "$NAME" drawing=on label="⇄" label.color=0xffd8647e
else
  sketchybar --set "$NAME" drawing=off
fi
