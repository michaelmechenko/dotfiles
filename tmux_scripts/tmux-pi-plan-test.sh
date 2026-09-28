#!/usr/bin/env bash
set -euo pipefail

ROOT=$(cd "$(dirname "$0")/.." && pwd)
TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT
export HOME="$TMP/home" TMPDIR="$TMP/tmp" PI_PLAN_STATE_DIR="$TMP/plans" LOG="$TMP/log"
mkdir -p "$HOME/.config/tmux_scripts" "$TMP/bin" "$TMPDIR" "$PI_PLAN_STATE_DIR"
cp "$ROOT/tmux_scripts/tmux-pi-plan" "$HOME/.config/tmux_scripts/"
cat >"$TMP/bin/tmux" <<'SH'
#!/bin/sh
case "$1" in
  display) printf '4242\n' ;;
  display-message) printf '%s\n' "$*" >>"$LOG" ;;
esac
SH
cat >"$HOME/.config/tmux_scripts/tmux-pi-session" <<'SH'
#!/bin/sh
printf '5151\t/repo\t/sessions/pi.jsonl\tpi-session\tMon Jan 1 00:00:00 2024\n'
SH
cat >"$HOME/.config/tmux_scripts/tmux-claude-open-split" <<'SH'
#!/bin/sh
[ "$1" = --temporary ]
printf '%s\n' "$(cat "$2")" >>"$LOG"
rm -f -- "$2"
SH
chmod +x "$TMP/bin/tmux" "$HOME/.config/tmux_scripts/"*
export PATH="$TMP/bin:$PATH"
cat >"$PI_PLAN_STATE_DIR/5151.json" <<'JSON'
{"version":1,"pid":5151,"sessionId":"pi-session","cwd":"/repo","processStartedAt":"Mon Jan 1 00:00:00 2024","markdown":"# Current plan\n\n- [ ] exact plan\n"}
JSON

: >"$LOG"
"$HOME/.config/tmux_scripts/tmux-pi-plan" %1 pi pi-session
grep -Fx '# Current plan' "$LOG" >/dev/null
grep -Fx -- '- [ ] exact plan' "$LOG" >/dev/null

: >"$LOG"
"$HOME/.config/tmux_scripts/tmux-pi-plan" %1 pi stale-session
grep -Fx 'display-message agent session changed' "$LOG" >/dev/null
if grep -q 'Current plan' "$LOG"; then
  echo 'stale plan identity was opened' >&2
  exit 1
fi

python3 - "$PI_PLAN_STATE_DIR/5151.json" <<'PY'
import json, pathlib, sys
path = pathlib.Path(sys.argv[1])
data = json.loads(path.read_text())
data["processStartedAt"] = "Sun Dec 31 23:59:59 2023"
path.write_text(json.dumps(data))
PY
: >"$LOG"
"$HOME/.config/tmux_scripts/tmux-pi-plan" %1 pi pi-session
grep -Fx 'display-message no active pi plan' "$LOG" >/dev/null

echo 'tmux pi plan tests passed'
