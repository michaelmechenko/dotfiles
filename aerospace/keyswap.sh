#!/usr/bin/env bash

set -euo pipefail

# Dispatch a numbered key to either a workspace switch or a window switch.
# Usage: keyswap.sh <default-role: ws|win> <n>
# Default (no flag): cmd-N => ws, cmd-shift-N => win. When the keyswap flag is
# present the two roles are swapped (toggled via toggle_keyswap.sh / cmd-shift-b).
FLAG=/tmp/aerospace_keyswap
ROLE="${1:-}"; N="${2:-}"
{ [ -z "$ROLE" ] || [ -z "$N" ]; } && exit 1

if [ -f "$FLAG" ]; then
  [ "$ROLE" = ws ] && ROLE=win || ROLE=ws
fi

if [ "$ROLE" = ws ]; then
  # cmd-2 falls back to secondary workspace 1^ when 2* is empty.
  if [ "$N" = 2 ] && [ -z "$(aerospace list-windows --workspace '2*' --format '%{window-id}' 2>/dev/null)" ]; then
    aerospace workspace '1^'
  else
    case "$N" in 1|2|3|4|5) aerospace workspace "${N}*" ;; esac   # no workspace 6*
  fi
else
  /bin/bash ~/.config/aerospace/focus_workspace_window.sh "$N"
fi
