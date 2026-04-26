#!/usr/bin/env bash

set -euo pipefail

DIRECTION="${1:-}"

if [ "$DIRECTION" != "next" ] && [ "$DIRECTION" != "prev" ]; then
  exit 1
fi

FOCUSED_WS="$(aerospace list-workspaces --focused --format '%{workspace}' 2>/dev/null || true)"
[ -z "$FOCUSED_WS" ] && exit 0

WINDOW_IDS=()
while IFS= read -r WINDOW_ID; do
  [ -n "$WINDOW_ID" ] && WINDOW_IDS+=("$WINDOW_ID")
done < <(aerospace list-windows --workspace "$FOCUSED_WS" --format '%{window-id}' 2>/dev/null || true)
WINDOW_COUNT="${#WINDOW_IDS[@]}"

# Nothing to cycle
[ "$WINDOW_COUNT" -le 1 ] && exit 0

CURRENT_ID="$(aerospace list-windows --focused --format '%{window-id}' 2>/dev/null || true)"

CURRENT_INDEX=-1
for i in "${!WINDOW_IDS[@]}"; do
  if [ "${WINDOW_IDS[$i]}" = "$CURRENT_ID" ]; then
    CURRENT_INDEX=$i
    break
  fi
done

# Fallback if current focus is missing or not part of this workspace
if [ "$CURRENT_INDEX" -lt 0 ]; then
  CURRENT_INDEX=0
fi

case "$DIRECTION" in
  next)
    TARGET_INDEX=$(( (CURRENT_INDEX + 1) % WINDOW_COUNT ))
    ;;
  prev)
    TARGET_INDEX=$(( (CURRENT_INDEX - 1 + WINDOW_COUNT) % WINDOW_COUNT ))
    ;;
esac

aerospace focus --window-id "${WINDOW_IDS[$TARGET_INDEX]}"
