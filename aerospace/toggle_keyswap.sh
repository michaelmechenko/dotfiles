#!/usr/bin/env bash

# Toggle the cmd-N / cmd-shift-N role swap (see keyswap.sh), then refresh the
# SketchyBar indicator.
FLAG=/tmp/aerospace_keyswap
if [ -f "$FLAG" ]; then rm -f "$FLAG"; else : > "$FLAG"; fi
sketchybar --trigger aerospace_keyswap_change 2>/dev/null || true
