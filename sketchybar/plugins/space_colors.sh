#!/usr/bin/env bash

# Batch-color ALL workspace indicators in ONE sketchybar call, driven by $FOCUSED_WORKSPACE
# (passed with the aerospace_workspace_change trigger; no IPC). Replaces 7 per-item aerospace.sh
# forks. Falls back to one aerospace query if the env var is absent (startup --update).
ACTIVE=0xffEDEDED
INACTIVE=0x80EDEDED
WS="${FOCUSED_WORKSPACE:-$(aerospace list-workspaces --focused --format '%{workspace}' 2>/dev/null)}"

CMD=(sketchybar)
for sid in "1^" "1*" "2*" "3*" "4*" "5*" "2^"; do
  if [ "$sid" = "$WS" ]; then c=$ACTIVE; else c=$INACTIVE; fi
  CMD+=(--set "space.$sid" icon.color="$c")
done
"${CMD[@]}"
