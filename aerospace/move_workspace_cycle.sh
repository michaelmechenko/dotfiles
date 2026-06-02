#!/usr/bin/env bash

set -euo pipefail

DIRECTION="${1:-}"

if [ "$DIRECTION" != "next" ] && [ "$DIRECTION" != "prev" ]; then
  exit 1
fi

FOCUSED_WS="$(aerospace list-workspaces --focused --format '%{workspace}' 2>/dev/null || true)"
[ -z "$FOCUSED_WS" ] && exit 1

case "$FOCUSED_WS" in
  *\*)
    WORKSPACES=("1*" "2*" "3*" "4*" "5*")
    ;;
  *\^)
    WORKSPACES=("1^" "2^")
    ;;
  *)
    exit 1
    ;;
esac

[ "${#WORKSPACES[@]}" -eq 0 ] && exit 1

if printf '%s\n' "${WORKSPACES[@]}" | aerospace move-node-to-workspace --stdin --focus-follows-window --wrap-around "$DIRECTION"; then
  hs -c "almostMaximize()"
fi
