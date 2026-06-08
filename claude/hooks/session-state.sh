#!/usr/bin/env bash
# Claude Code hook: track per-session "awaiting-permission" state for the tmux
# menu. Reads the hook JSON on stdin; arg = state to write, or "clear" to remove.
#   awaiting-permission  (Notification matcher permission_prompt)
#   clear                (PreToolUse / Stop / UserPromptSubmit)

state="$1"
dir="/tmp/claude-session-state"
mkdir -p "$dir"

sid=$(jq -r '.session_id // empty')
[ -n "$sid" ] || exit 0

if [ "$state" = "clear" ]; then
  rm -f "$dir/$sid"
else
  printf '%s' "$state" > "$dir/$sid"
fi
exit 0
