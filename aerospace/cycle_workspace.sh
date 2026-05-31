#!/usr/bin/env bash

set -euo pipefail

DIRECTION="${1:-}"

if [ "$DIRECTION" != "next" ] && [ "$DIRECTION" != "prev" ]; then
  exit 1
fi

# Fixed left->right order, crossing the main (*) -> secondary (^) monitor boundary.
ORDER=("1*" "2*" "3*" "4*" "5*" "1^" "2^")

NONEMPTY="$(aerospace list-workspaces --monitor all --empty no --format '%{workspace}' 2>/dev/null || true)"
FOCUSED="$(aerospace list-workspaces --focused --format '%{workspace}' 2>/dev/null || true)"
[ -z "$FOCUSED" ] && exit 1

# Candidate cycle: fixed order, kept if non-empty OR currently focused.
LIST=()
for ws in "${ORDER[@]}"; do
  if [ "$ws" = "$FOCUSED" ] || printf '%s\n' "$NONEMPTY" | grep -qxF -- "$ws"; then
    LIST+=("$ws")
  fi
done

COUNT="${#LIST[@]}"
[ "$COUNT" -le 1 ] && exit 0

CUR=-1
for i in "${!LIST[@]}"; do
  if [ "${LIST[$i]}" = "$FOCUSED" ]; then
    CUR=$i
    break
  fi
done
[ "$CUR" -lt 0 ] && CUR=0

if [ "$DIRECTION" = "next" ]; then
  TGT=$(( (CUR + 1) % COUNT ))
else
  TGT=$(( (CUR - 1 + COUNT) % COUNT ))
fi

aerospace workspace "${LIST[$TGT]}"
