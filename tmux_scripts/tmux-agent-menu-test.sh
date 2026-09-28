#!/usr/bin/env bash
set -euo pipefail

ROOT=$(cd "$(dirname "$0")/.." && pwd)
TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT
export HOME="$TMP/home" LOG="$TMP/log"
mkdir -p "$HOME/.config/tmux_scripts" "$TMP/bin"
cp "$ROOT/tmux_scripts/tmux-claude-menu" "$HOME/.config/tmux_scripts/"
cat >"$HOME/.config/tmux_scripts/tmux-agent-ls" <<'SH'
#!/bin/sh
printf 'c-session\t%%1\tmain:1.1\tmain\twaiting\tclaude-name\t/c.jsonl\tchat\tclaude\t/repo\t-\n'
printf 'p-session\t%%2\tmain:1.2\tmain\tthinking\t-\t/p.jsonl\twork\tpi\t/repo\t-\n'
SH
cat >"$TMP/bin/tmux" <<'SH'
#!/bin/sh
case "$1" in
  show-options|show) printf '#656a80\n' ;;
  display) printf '4242\n' ;;
  send-keys|kill-pane) printf '%s\n' "$*" >>"$LOG" ;;
esac
SH
cat >"$HOME/.config/tmux_scripts/tmux-pi-session" <<'SH'
#!/bin/sh
printf '4242\t/repo\t/p.jsonl\t%s\n' "${PI_SESSION_ID:-p-session}"
SH
chmod +x "$TMP/bin/tmux" "$HOME/.config/tmux_scripts/"*
export PATH="$TMP/bin:$PATH"

out=$("$HOME/.config/tmux_scripts/tmux-claude-menu" --colorize)
printf '%s\n' "$out" | grep -F 'claude' >/dev/null
printf '%s\n' "$out" | grep -F 'pi' >/dev/null

: >"$LOG"
"$HOME/.config/tmux_scripts/tmux-claude-menu" --act approve p-session %2 pi
"$HOME/.config/tmux_scripts/tmux-claude-menu" --act kill p-session %2 pi
[ ! -s "$LOG" ] || { echo 'Pi inherited Claude-only approve/kill action' >&2; exit 1; }
"$HOME/.config/tmux_scripts/tmux-claude-menu" --act approve c-session %1 claude
grep -Fx 'send-keys -t %1 Enter' "$LOG" >/dev/null

: >"$LOG"
printf 'hello\n' | PI_SESSION_ID=p-session "$HOME/.config/tmux_scripts/tmux-claude-menu" --send p-session %2 pi >/dev/null
grep -Fx 'send-keys -t %2 -l hello' "$LOG" >/dev/null
: >"$LOG"
printf 'wrong target\n' | PI_SESSION_ID=replacement "$HOME/.config/tmux_scripts/tmux-claude-menu" --send p-session %2 pi >/dev/null
[ ! -s "$LOG" ] || { echo 'message reached a replacement Pi session' >&2; exit 1; }

echo 'tmux agent menu tests passed'
