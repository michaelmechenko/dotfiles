#!/usr/bin/env bash

set -euo pipefail

INDEX="${1:-}"

if ! [[ "$INDEX" =~ ^[1-9][0-9]*$ ]]; then
  exit 1
fi

FOCUSED_WS="$(aerospace list-workspaces --focused --format '%{workspace}' 2>/dev/null || true)"
[ -z "$FOCUSED_WS" ] && exit 1

WINDOW_ID="$({ aerospace list-windows --workspace "$FOCUSED_WS" --format '%{window-id}' 2>/dev/null || true; } | sed -n "${INDEX}p")"
[ -z "$WINDOW_ID" ] && exit 0

aerospace focus --window-id "$WINDOW_ID"
