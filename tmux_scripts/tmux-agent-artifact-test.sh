#!/usr/bin/env bash
set -euo pipefail

ROOT=$(cd "$(dirname "$0")/.." && pwd)
TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT
export HOME="$TMP/home" TMPDIR="$TMP/tmp" LOG="$TMP/log"
mkdir -p "$HOME/.config/tmux_scripts" "$TMP/bin" "$TMPDIR"
cp "$ROOT/tmux_scripts/tmux-pi-last-response" "$HOME/.config/tmux_scripts/"
cp "$ROOT/tmux_scripts/tmux-claude-last-response" "$HOME/.config/tmux_scripts/"

cat >"$TMP/bin/tmux" <<'SH'
#!/bin/sh
case "$1" in
  display)
    case "$*" in *pane_pid*) printf '4242\n' ;; *) printf '%%1\n' ;; esac ;;
  display-message) printf 'tmux:%s\n' "$*" >>"$LOG" ;;
esac
SH
cat >"$HOME/.config/tmux_scripts/tmux-pi-session" <<SH
#!/bin/sh
printf '4242\t/tmp\t$TMP/pi.jsonl\tpi-session\n'
SH
cat >"$HOME/.config/tmux_scripts/tmux-claude-ls" <<SH
#!/bin/sh
printf 'claude-session\t%%1\ttarget\tsession\tidle\tname\t$TMP/claude.jsonl\twindow\n'
SH
cat >"$HOME/.config/tmux_scripts/tmux-claude-open-split" <<'SH'
#!/bin/sh
[ "$1" = --temporary ] || { echo 'artifact was not marked temporary' >&2; exit 1; }
file=$2
[ "${FAIL_SPLIT:-}" != 1 ] || exit 1
perms=$(LC_ALL=C ls -ld "$file" | cut -c1-10)
printf '%s\t%s\t%s\n' "$file" "$perms" "$(cat "$file")" >>"$LOG"
rm -f -- "$file"
SH
chmod +x "$TMP/bin/tmux" "$HOME/.config/tmux_scripts/"*
export PATH="$TMP/bin:$PATH"

cat >"$TMP/pi.jsonl" <<'JSON'
{"type":"message","message":{"role":"assistant","content":[{"type":"text","text":"first"}]}}
{"type":"message","message":{"role":"assistant","content":[{"type":"toolCall","name":"read"}]}}
JSON
cat >"$TMP/claude.jsonl" <<'JSON'
{"type":"assistant","message":{"content":[{"type":"text","text":"claude text"}]}}
{"type":"assistant","message":{"content":[{"type":"tool_use","name":"read"}]}}
JSON

: >"$LOG"
"$HOME/.config/tmux_scripts/tmux-pi-last-response" %1 pi pi-session
"$HOME/.config/tmux_scripts/tmux-claude-last-response" %1 claude claude-session
[ "$(wc -l <"$LOG")" -eq 2 ]
awk -F '\t' '$1 ~ /\/pi-resp\.[A-Za-z0-9]+$/ && $2 == "-rw-------" && $3 == "first" { found=1 } END { exit(found ? 0 : 1) }' "$LOG"
awk -F '\t' '$1 ~ /\/claude-resp\.[A-Za-z0-9]+$/ && $2 == "-rw-------" && $3 == "claude text" { found=1 } END { exit(found ? 0 : 1) }' "$LOG"
if find "$TMPDIR" -type f | grep -q .; then
  echo 'temporary response file leaked' >&2
  exit 1
fi
FAIL_SPLIT=1 "$HOME/.config/tmux_scripts/tmux-pi-last-response" %1 pi pi-session
FAIL_SPLIT=1 "$HOME/.config/tmux_scripts/tmux-claude-last-response" %1 claude claude-session
if find "$TMPDIR" -type f | grep -q .; then
  echo 'failed split leaked a temporary response file' >&2
  exit 1
fi

echo 'tmux agent artifact tests passed'
