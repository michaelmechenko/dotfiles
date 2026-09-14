#!/usr/bin/env bash
# Isolated tsave/tload authority, atomicity, metadata, and opt-in-resume checks.
set -euo pipefail

ROOT=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
# Keep the named tmux socket below macOS's short Unix-domain path limit.
TMP=$(mktemp -d "/tmp/tmux-snapshot-test.XXXXXX")
SOCKET="tmux-snapshot-test-$$"
REAL_TMUX=$(command -v tmux)
cleanup() {
  "$REAL_TMUX" -L "$SOCKET" kill-server 2>/dev/null || true
  rm -rf "$TMP"
}
trap cleanup EXIT HUP INT TERM

HOME_DIR="$TMP/home"
BIN="$TMP/bin"
mkdir -p "$HOME_DIR/.config/tmux_scripts" "$HOME_DIR/.config/tmux_sessions" "$BIN"
cp "$ROOT/tmux_scripts/tsave" "$ROOT/tmux_scripts/tload" "$ROOT/tmux_scripts/tmux-pi-session" "$ROOT/tmux_scripts/tmux-snapshot-codec.py" "$HOME_DIR/.config/tmux_scripts/"
cat >"$BIN/tmux" <<EOF
#!/bin/sh
if [ "\${FAIL_LIST_PANES:-}" = 1 ] && [ "\${1:-}" = list-panes ]; then exit 73; fi
exec "$REAL_TMUX" -L "$SOCKET" "\$@"
EOF
chmod +x "$BIN/tmux" "$HOME_DIR/.config/tmux_scripts/"*
export HOME="$HOME_DIR" PATH="$BIN:$PATH" TMUX_TMPDIR="$TMP"

fail() { printf 'FAIL: %s\n' "$*" >&2; exit 1; }
assert_eq() { [ "$1" = "$2" ] || fail "$3: got [$1], want [$2]"; }

# No snapshot name may escape the authority directory.
if "$HOME_DIR/.config/tmux_scripts/tsave" ../escape >/dev/null 2>&1; then
  fail "snapshot traversal name accepted"
fi

HOSTILE_CWD=$'cwd-\x1f-newline\n-tab\t-unicode-λ'
mkdir -p "$TMP/$HOSTILE_CWD"
"$REAL_TMUX" -L "$SOCKET" -f /dev/null new-session -d -s 'work space' -c "$TMP/$HOSTILE_CWD" /bin/zsh
PANE=$("$REAL_TMUX" -L "$SOCKET" display-message -p -t '=work space:' '#{pane_id}')
TITLE="title ' ; \$ unicode-λ"
LABEL=$'label\twith \x1f tab;$(touch nope)'
"$REAL_TMUX" -L "$SOCKET" select-pane -t "$PANE" -T "$TITLE"
"$REAL_TMUX" -L "$SOCKET" set-option -p -t "$PANE" @pane-label "$LABEL"
"$REAL_TMUX" -L "$SOCKET" set-option -p -t "$PANE" @pane-named 1

"$HOME_DIR/.config/tmux_scripts/tsave" stable >/dev/null
JSON="$HOME_DIR/.config/tmux_sessions/stable.json"
[ -s "$JSON" ] || fail "snapshot JSON missing"
assert_eq "$(jq -r '.schema_version' "$JSON")" 1 "schema version"
assert_eq "$(jq -r '.sessions[0].windows[0].panes[0].title' "$JSON")" "$TITLE" "saved title"
assert_eq "$(jq -r '.sessions[0].windows[0].panes[0].cwd' "$JSON")" "$(CDPATH= cd -- "$TMP/$HOSTILE_CWD" && pwd -P)" "saved hostile cwd"
assert_eq "$(jq -r '.sessions[0].windows[0].panes[0].pane_label' "$JSON")" "$LABEL" "saved pane label"
BEFORE=$(shasum -a 256 "$JSON" | awk '{print $1}')
if FAIL_LIST_PANES=1 "$HOME_DIR/.config/tmux_scripts/tsave" stable >/dev/null 2>&1; then
  fail "failed collection reported success"
fi
assert_eq "$(shasum -a 256 "$JSON" | awk '{print $1}')" "$BEFORE" "failed collection replaced good JSON"

# Malformed input must be rejected before creating a session.
printf '{"sessions":"bad"}\n' >"$TMP/bad.json"
COUNT_BEFORE=$("$REAL_TMUX" -L "$SOCKET" list-sessions -F '#{session_id}' | wc -l | tr -d ' ')
if TMUX=fixture "$HOME_DIR/.config/tmux_scripts/tload" "$TMP/bad.json" >/dev/null 2>&1; then
  fail "malformed snapshot accepted"
fi
COUNT_AFTER=$("$REAL_TMUX" -L "$SOCKET" list-sessions -F '#{session_id}' | wc -l | tr -d ' ')
assert_eq "$COUNT_AFTER" "$COUNT_BEFORE" "malformed load had side effects"

# Semantically inconsistent identities are rejected before any restore side effect.
semantic_cases=(
  '.sessions += [.sessions[0]]'
  '.sessions[0].windows[0].panes += [.sessions[0].windows[0].panes[0]]'
  '.sessions[0].active_window = 999'
  '.sessions[0].windows[0].active_pane = 999'
  '.sessions[0].windows[0].panes[0].index = 1.5'
  '.sessions[0].name = "bad:name"'
)
case_no=0
for filter in "${semantic_cases[@]}"; do
  case_no=$((case_no + 1))
  jq "$filter" "$JSON" >"$TMP/bad-semantic-$case_no.json"
  if TMUX=fixture "$HOME_DIR/.config/tmux_scripts/tload" "$TMP/bad-semantic-$case_no.json" >/dev/null 2>&1; then
    fail "semantic snapshot case $case_no accepted"
  fi
done
assert_eq "$("$REAL_TMUX" -L "$SOCKET" list-sessions -F '#{session_id}' | wc -l | tr -d ' ')" "$COUNT_BEFORE" "semantic validation had side effects"

# Restore reports a vanished cwd, falls back explicitly, and reapplies metadata.
MISSING="$TMP/vanished"
jq --arg cwd "$MISSING" '.sessions[0].windows[0].panes[0].cwd=$cwd' "$JSON" >"$TMP/restore.json"
"$REAL_TMUX" -L "$SOCKET" kill-session -t '=work space'
ERR=$(TMUX=fixture "$HOME_DIR/.config/tmux_scripts/tload" "$TMP/restore.json" 2>&1 >/dev/null)
case "$ERR" in *"missing cwd $MISSING; using $HOME_DIR"*) ;; *) fail "missing cwd was not reported: $ERR" ;; esac
PANE=$("$REAL_TMUX" -L "$SOCKET" display-message -p -t '=work space:' '#{pane_id}')
HOME_REAL=$(CDPATH= cd -- "$HOME_DIR" && pwd -P)
assert_eq "$("$REAL_TMUX" -L "$SOCKET" display-message -p -t "$PANE" '#{pane_current_path}')" "$HOME_REAL" "missing cwd fallback"
assert_eq "$("$REAL_TMUX" -L "$SOCKET" display-message -p -t "$PANE" '#{pane_title}')" "$TITLE" "restored title"
assert_eq "$("$REAL_TMUX" -L "$SOCKET" show-options -pqv -t "$PANE" @pane-label)" "$LABEL" "restored pane label"
assert_eq "$("$REAL_TMUX" -L "$SOCKET" show-options -pqv -t "$PANE" @pane-named)" 1 "restored named marker"

# A saved agent identity only types an interactive prompt; it never launches the agent.
jq '.sessions[0].name="agent.restore" | .sessions[0].windows[0].panes[0].claude_session="sid-safe"' "$JSON" >"$TMP/agent.json"
TMUX=fixture "$HOME_DIR/.config/tmux_scripts/tload" "$TMP/agent.json" >/dev/null
sleep 0.1
AGENT_PANE=$("$REAL_TMUX" -L "$SOCKET" display-message -p -t '=agent.restore:' '#{pane_id}')
assert_eq "$("$REAL_TMUX" -L "$SOCKET" display-message -p -t "$AGENT_PANE" '#{pane_current_command}')" zsh "agent auto-resumed"
"$REAL_TMUX" -L "$SOCKET" capture-pane -p -t "$AGENT_PANE" | grep -Fq 'Resume this session?' || fail "resume prompt missing"

printf 'ok: tmux snapshot authority and round-trip\n'
