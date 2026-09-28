#!/usr/bin/env bash
set -euo pipefail

ROOT=$(cd "$(dirname "$0")/.." && pwd)
TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT
mkdir -p "$TMP/bin" "$TMP/maps/1234"
export LOG="$TMP/log" TMPDIR="$TMP/maps" TMUX='/tmp/tmux-test/default,1234,0' TMUX_PANE=%1

cat >"$TMP/bin/tmux" <<'SH'
#!/bin/sh
case "$1" in
  display-message)
    target=''
    while [ "$#" -gt 0 ]; do
      [ "$1" = -t ] && { target=$2; shift 2; continue; }
      fmt=$1; shift
    done
    case "$fmt:$target" in
      '#{window_id}:%1') printf '@1\n' ;;
      '#{@nnn_preview}|#{window_id}:%2') printf '1|@1\n' ;;
      '#{session_name}|#{@nnn_popup_token}:%1') printf '%s|%s\n' "${TEST_SESSION:-main}" "${TEST_TOKEN:-}" ;;
      *) exit 1 ;;
    esac ;;
  send-keys|kill-session) printf '%s\n' "$*" >>"$LOG" ;;
esac
SH
chmod +x "$TMP/bin/tmux"
export PATH="$TMP/bin:$PATH"

: >"$LOG"
"$ROOT/nnn/plugins/.nnn-preview-scroll" up
[ ! -s "$LOG" ] || { echo 'missing preview mapping targeted another pane' >&2; exit 1; }

mkdir -p "$TMP/maps/nnn-preview-panes/1234"
printf '%%2' >"$TMP/maps/nnn-preview-panes/1234/%1"
"$ROOT/nnn/plugins/.nnn-preview-scroll" down
grep -Fx 'send-keys -t %2 -N 10 Down' "$LOG" >/dev/null

: >"$LOG"
unset NNN_POPUP_SESSION
"$ROOT/nnn/plugins/.nnn-popup-close"
[ ! -s "$LOG" ] || { echo 'plain nnn closed a popup session' >&2; exit 1; }
export NNN_POPUP_SESSION=nnn-popup-1 NNN_POPUP_TOKEN=owner-1 TEST_SESSION=main TEST_TOKEN=''
"$ROOT/nnn/plugins/.nnn-popup-close"
[ ! -s "$LOG" ] || { echo 'foreign session was closed' >&2; exit 1; }
export TEST_SESSION=nnn-popup-1 TEST_TOKEN=owner-2
"$ROOT/nnn/plugins/.nnn-popup-close"
[ ! -s "$LOG" ] || { echo 'foreign popup owner was closed' >&2; exit 1; }
export TEST_TOKEN=owner-1
"$ROOT/nnn/plugins/.nnn-popup-close"
grep -Fx 'kill-session -t =nnn-popup-1' "$LOG" >/dev/null

work="$TMP/search"
mkdir -p "$work"
printf 'needle\n' >"$work/a:b.txt"
printf 'needle\n' >"$work/line
break.txt"
bad_name=$'invalid-\xff.txt'
printf 'needle\n' >"$work/$bad_name"
control_name=$'escape-\033[31m.txt'
printf 'needle\033[31m\n' >"$work/$control_name"
(
  cd "$work"
  "$ROOT/nnn/plugins/fzrg" --search needle >"$TMP/results"
)
[ "$(wc -l <"$TMP/results")" -eq 4 ]
base64_decode() {
  if base64 --help 2>&1 | grep -q -- '--decode'; then base64 --decode; else base64 -D; fi
}
while IFS=$'\t' read -r encoded line column display; do
  path=$(printf '%s' "$encoded" | base64_decode)
  [ -f "$work/$path" ]
  [ "$line" = 1 ]
  [ "$column" = 1 ]
  case "$display" in *needle*) ;; *) exit 1 ;; esac
  clean=${display//$'\033[4m'/}
  clean=${clean//$'\033[24m'/}
  case "$clean" in *$'\033'*) echo 'filename injected terminal controls' >&2; exit 1 ;; esac
done <"$TMP/results"

echo 'tmux nnn safety tests passed'
