#!/usr/bin/env bash
set -euo pipefail

ROOT=$(cd "$(dirname "$0")/.." && pwd)
TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT
export HOME="$TMP/home" TMPDIR="$TMP/tmp" LOG="$TMP/log" CMD_LOG="$TMP/cmd"
mkdir -p "$HOME/.config/tmux_scripts" "$TMP/bin" "$TMPDIR"
cp "$ROOT/tmux_scripts/tmux-pi-prompt" "$HOME/.config/tmux_scripts/"
cat >"$HOME/.config/tmux_scripts/tmux-agent-ls" <<'SH'
#!/bin/sh
[ -n "${AGENT_ROW:-}" ] && printf '%b\n' "$AGENT_ROW"
SH
cat >"$HOME/.config/tmux_scripts/tmux-pi-session" <<'SH'
#!/bin/sh
sid=$(printf '%b\n' "${AGENT_ROW:-}" | cut -f1)
[ -n "$sid" ] && printf '4242\t/repo\t/transcript\t%s\n' "$sid"
SH
cat >"$TMP/bin/tmux" <<'SH'
#!/bin/sh
case "$1" in
  display)
    for arg do last=$arg; done
    case "$last" in '#{pane_id}') printf '%%1\n' ;; '#{pane_pid}') printf '4242\n' ;; '#{pane_current_path}') printf '/repo\n' ;; esac ;;
  split-window)
    for arg do last=$arg; done
    printf '%s' "$last" >"$CMD_LOG" ;;
  load-buffer|paste-buffer|display-message) printf '%s\n' "$*" >>"$LOG" ;;
esac
SH
chmod +x "$TMP/bin/tmux" "$HOME/.config/tmux_scripts/"*
export PATH="$TMP/bin:$PATH"

run_editor() {
  mode=$1
  cat >"$TMP/bin/nvim" <<SH
#!/bin/sh
for arg do file=\$arg; done
printf 'hello from editor' >"\$file"
exit $mode
SH
  chmod +x "$TMP/bin/nvim"
  bash -c "$(cat "$CMD_LOG")"
}

: >"$LOG"
"$HOME/.config/tmux_scripts/tmux-pi-prompt" %1
case "$(cat "$CMD_LOG")" in *'trap cleanup EXIT;'*"trap 'exit 143' TERM"*) ;; *) echo 'prompt split lacks terminating signal cleanup traps' >&2; exit 1 ;; esac
run_editor 1
[ ! -s "$LOG" ] || { echo 'cancelled editor delivered content' >&2; cat "$LOG" >&2; exit 1; }

: >"$LOG"
"$HOME/.config/tmux_scripts/tmux-pi-prompt" %1
first_cmd=$(cat "$CMD_LOG")
run_editor 0
first_buffer=$(awk '$1 == "load-buffer" { for (i=1;i<=NF;i++) if ($i=="-b") print $(i+1) }' "$LOG")
grep -F 'paste-buffer -p -d -b' "$LOG" >/dev/null

: >"$LOG"
"$HOME/.config/tmux_scripts/tmux-pi-prompt" %1
second_cmd=$(cat "$CMD_LOG")
run_editor 0
second_buffer=$(awk '$1 == "load-buffer" { for (i=1;i<=NF;i++) if ($i=="-b") print $(i+1) }' "$LOG")
[ "$first_cmd" != "$second_cmd" ]
[ "$first_buffer" != "$second_buffer" ]

: >"$LOG"
: >"$CMD_LOG"
export AGENT_ROW=$'other\t%1\ttarget\tsession\tidle\tname\t/transcript\twindow\tpi\t/repo\t-'
"$HOME/.config/tmux_scripts/tmux-pi-prompt" %1 pi expected
grep -Fx 'display-message agent session changed' "$LOG" >/dev/null
[ ! -s "$CMD_LOG" ] || { echo 'stale selected agent opened an editor' >&2; exit 1; }

: >"$LOG"
export AGENT_ROW=$'expected\t%1\ttarget\tsession\tidle\tname\t/transcript\twindow\tpi\t/repo\t-'
"$HOME/.config/tmux_scripts/tmux-pi-prompt" %1 pi expected
export AGENT_ROW=$'replacement\t%1\ttarget\tsession\tidle\tname\t/transcript\twindow\tpi\t/repo\t-'
run_editor 0
grep -Fx 'display-message agent session changed' "$LOG" >/dev/null
if grep -Eq '^(load-buffer|paste-buffer)' "$LOG"; then
  echo 'replacement agent received composed prompt' >&2
  exit 1
fi

echo 'tmux prompt tests passed'
