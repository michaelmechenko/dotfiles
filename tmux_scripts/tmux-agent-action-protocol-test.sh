#!/usr/bin/env bash
set -euo pipefail

ROOT=$(cd "$(dirname "$0")/.." && pwd)
TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT
export HOME="$TMP/home" LOG="$TMP/log"
mkdir -p "$HOME/.config/tmux_scripts" "$TMP/bin"
cp "$ROOT/tmux_scripts/tmux-agent-action" "$HOME/.config/tmux_scripts/"
cp "$ROOT/tmux_scripts/tmux-M-P-dispatch" "$HOME/.config/tmux_scripts/"

cat >"$TMP/bin/tmux" <<'SH'
#!/bin/sh
[ "$1" = display ] && { printf '%%1\n'; exit 0; }
printf 'tmux:%s\n' "$*" >>"$LOG"
SH
cat >"$HOME/.config/tmux_scripts/tmux-agent-ls" <<'SH'
#!/bin/sh
[ -n "${AGENT_ROW:-}" ] && printf '%b\n' "$AGENT_ROW"
SH
for script in tmux-claude-plan tmux-pi-plan tmux-claude-last-response tmux-pi-last-response tmux-pi-prompt; do
cat >"$HOME/.config/tmux_scripts/$script" <<SH
#!/bin/sh
printf '$script:%s|%s|%s\n' "\$1" "\${2:-}" "\${3:-}" >>"\$LOG"
SH
done
chmod +x "$TMP/bin/tmux" "$HOME/.config/tmux_scripts/"*
export PATH="$TMP/bin:$PATH"

assert_log() { grep -Fx "$1" "$LOG" >/dev/null || { cat "$LOG" >&2; exit 1; }; }

: >"$LOG"
export AGENT_ROW=$'claude-session\t%1\ttarget\tsession\tidle\tname\t/transcript\twindow\tclaude\t/repo\t-'
"$HOME/.config/tmux_scripts/tmux-agent-action" plan %1
assert_log 'tmux-claude-plan:%1|claude-session|'
"$HOME/.config/tmux_scripts/tmux-agent-action" response %1 claude claude-session
assert_log 'tmux-claude-last-response:%1|claude|claude-session'

: >"$LOG"
export AGENT_ROW=$'pi-session\t%1\ttarget\tsession\tidle\tname\t/transcript\twindow\tpi\t/repo\t-'
"$HOME/.config/tmux_scripts/tmux-M-P-dispatch" %1 pi pi-session
assert_log 'tmux-pi-plan:%1|pi|pi-session'
"$HOME/.config/tmux_scripts/tmux-agent-action" response %1 pi pi-session
assert_log 'tmux-pi-last-response:%1|pi|pi-session'
"$HOME/.config/tmux_scripts/tmux-agent-action" prompt %1
assert_log 'tmux-pi-prompt:%1|pi|pi-session'

: >"$LOG"
"$HOME/.config/tmux_scripts/tmux-agent-action" plan %1 claude replacement-session
assert_log 'tmux:display-message agent session changed'
if grep -Eq '^tmux-(claude|pi)-(plan|last-response):' "$LOG"; then
  echo 'mismatched agent dispatched' >&2
  exit 1
fi

: >"$LOG"
unset AGENT_ROW
"$HOME/.config/tmux_scripts/tmux-agent-action" plan %1
assert_log 'tmux:display-message no agent session in this pane'

echo 'tmux agent action protocol tests passed'
