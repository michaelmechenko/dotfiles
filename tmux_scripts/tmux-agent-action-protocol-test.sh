#!/usr/bin/env bash
set -euo pipefail

ROOT=$(cd "$(dirname "$0")/.." && pwd)
TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT
export HOME="$TMP/home"
export LOG="$TMP/log"
mkdir -p "$HOME/.config/tmux_scripts" "$TMP/bin"
cp "$ROOT/tmux_scripts/tmux-M-P-dispatch" "$HOME/.config/tmux_scripts/"
cp "$ROOT/tmux_scripts/tmux-claude-last-response" "$HOME/.config/tmux_scripts/"
cp "$ROOT/tmux_scripts/tmux-pi-last-response" "$HOME/.config/tmux_scripts/"

cat > "$TMP/bin/tmux" <<'SH'
#!/bin/sh
if [ "$1" = display ] && [ "$2" = -p ]; then printf '%s\n' '%1'; exit 0; fi
if [ "$1" = display-message ] && [ "$2" = -p ]; then printf '%s\n' '4242'; exit 0; fi
printf 'tmux:%s\n' "$*" >> "$LOG"
SH
cat > "$HOME/.config/tmux_scripts/tmux-claude-ls" <<'SH'
#!/bin/sh
[ -n "${CLAUDE_ROW:-}" ] && printf '%b\n' "$CLAUDE_ROW"
SH
cat > "$HOME/.config/tmux_scripts/tmux-claude-plan" <<'SH'
#!/bin/sh
printf 'plan:%s|%s\n' "$1" "${2:-}" >> "$LOG"
SH
cat > "$HOME/.config/tmux_scripts/tmux-pi-last-response" <<'SH'
#!/bin/sh
printf 'pi:%s|%s\n' "$1" "${2:-}" >> "$LOG"
SH
cat > "$HOME/.config/tmux_scripts/tmux-pi-session" <<'SH'
#!/bin/sh
printf '4242\t%%1\t/not-needed.jsonl\tpi-session\n'
SH
chmod +x "$TMP/bin/tmux" "$HOME/.config/tmux_scripts/"*
export PATH="$TMP/bin:$PATH"

: > "$LOG"
export CLAUDE_ROW=$'claude-session\t%1\ttarget\tsession\tidle\tname\t/missing\twindow'
"$HOME/.config/tmux_scripts/tmux-M-P-dispatch"
grep -Fx 'plan:%1|' "$LOG" >/dev/null

: > "$LOG"
"$HOME/.config/tmux_scripts/tmux-M-P-dispatch" '%1' 'claude-session'
grep -Fx 'plan:%1|claude-session' "$LOG" >/dev/null

: > "$LOG"
"$HOME/.config/tmux_scripts/tmux-M-P-dispatch" '%1' pi pi-session
grep -Fx 'tmux:display-message agent session changed' "$LOG" >/dev/null
if grep -Eq '^(plan|pi):' "$LOG"; then
  echo 'mismatched agent dispatched' >&2
  exit 1
fi

: > "$LOG"
"$HOME/.config/tmux_scripts/tmux-claude-last-response" '%1' claude replacement-session
grep -Fx 'tmux:display-message agent session changed' "$LOG" >/dev/null

: > "$LOG"
unset CLAUDE_ROW
"$ROOT/tmux_scripts/tmux-pi-last-response" '%1' pi replacement-session
grep -Fx 'tmux:display-message agent session changed' "$LOG" >/dev/null

echo 'tmux agent action protocol tests passed'
