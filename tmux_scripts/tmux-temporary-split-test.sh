#!/usr/bin/env bash
set -euo pipefail

ROOT=$(cd "$(dirname "$0")/.." && pwd)
TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT
export PATH="$TMP/bin:$PATH" CMD_LOG="$TMP/cmd" SPLIT_LOG="$TMP/split" NVIM_LOG="$TMP/nvim"
mkdir -p "$TMP/bin"
cat >"$TMP/bin/tmux" <<'SH'
#!/bin/sh
case "$1" in
  list-panes) printf '0\t%%1\t\n50\t%%2\t1\n' ;;
  split-window) printf '%s\n' "$*" >>"$SPLIT_LOG"; for arg do cmd=$arg; done; printf '%s' "$cmd" >"$CMD_LOG" ;;
  *) exit 1 ;;
esac
SH
cat >"$TMP/bin/nvim" <<'SH'
#!/bin/sh
printf '%s\n' "$*" >"$NVIM_LOG"
SH
chmod +x "$TMP/bin/tmux" "$TMP/bin/nvim"

artifact="$TMP/response with quote'.tmp"
printf 'private response' >"$artifact"
"$ROOT/tmux_scripts/tmux-claude-open-split" --temporary "$artifact" %1
grep -F -- "split-window -h -t %1" "$SPLIT_LOG" >/dev/null || { echo "sidebar changed split placement" >&2; exit 1; }
cmd=$(cat "$CMD_LOG")
case "$cmd" in *'trap cleanup EXIT;'*"trap 'exit 143' TERM"*) ;; *) echo 'temporary split lacks terminating signal cleanup traps' >&2; exit 1 ;; esac
bash -c "$cmd"
[ ! -e "$artifact" ] || { echo 'temporary split left its artifact' >&2; exit 1; }
grep -F -- "-c setfiletype markdown --" "$NVIM_LOG" >/dev/null

printf 'persistent' >"$artifact"
"$ROOT/tmux_scripts/tmux-claude-open-split" "$artifact" %1
cmd=$(cat "$CMD_LOG")
bash -c "$cmd"
[ -e "$artifact" ] || { echo 'ordinary split removed a persistent file' >&2; exit 1; }

echo 'tmux temporary split tests passed'
