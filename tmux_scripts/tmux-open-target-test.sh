#!/usr/bin/env bash
# Action-dispatch tests for tmux-open-target (stdlib bash, no deps).
#
# Drives the explicit pane/action interface against a throwaway tmux server and a
# OPEN_TARGET_DRY_RUN=1 seam that prints the final command instead of executing it.
# Run: bash tmux_scripts/tmux-open-target-test.sh
#
# Red until tmux-open-target implements:
#   tmux-open-target <action> <pane> <target> [line]   action in {open,copy,finder,nvim}
#   tmux-open-target <sel>                              legacy (1 arg) backward-compat open
set -u

CONF="$HOME/.config/tmux_scripts"
TARGET="$CONF/tmux-open-target"
SRV="openpickertest$$"
TMP="$(mktemp -d)"
TMUX_BIN="$(command -v tmux)"
SHIM="$TMP/shim"
mkdir -p "$SHIM"
cat >"$SHIM/tmux" <<EOF
#!/bin/sh
exec "$TMUX_BIN" -L "$SRV" "\$@"
EOF
chmod +x "$SHIM/tmux"
export PATH="$SHIM:$PATH"
pass=0
fail=0

assert_contains() { # label haystack needle
  if printf '%s' "$2" | grep -qF -- "$3"; then
    pass=$((pass+1)); printf 'ok   %s\n' "$1"
  else
    fail=$((fail+1)); printf 'FAIL %s\n  expected needle: %s\n  got: %s\n' "$1" "$3" "$2"
  fi
}

cleanup() {
  tmux -L "$SRV" kill-server 2>/dev/null || true
  rm -rf "$TMP"
}
trap cleanup EXIT

tmux -L "$SRV" new-session -d -s s -x 200 -y 50 -c "$TMP" 2>/dev/null
PANE="$(tmux -L "$SRV" display -p '#{pane_id}')"
mkdir -p "$TMP/sub"
: >"$TMP/notes.txt"
: >"$TMP/sub/main.rs"
mkdir -p "$TMP/dir"

run() { OPEN_TARGET_DRY_RUN=1 "$TARGET" "$@"; }

echo "## explicit action interface ##"
out="$(run open "$PANE" "$TMP/notes.txt")";         assert_contains "open file -> nvim split" "$out" "split-window"
assert_contains "open file carries path"            "$out" "notes.txt"
out="$(run nvim "$PANE" "$TMP/sub/main.rs" 42)";    assert_contains "nvim action + line"      "$out" "+42"
out="$(run copy "$PANE" "$TMP/notes.txt")";          assert_contains "copy uses pbcopy"         "$out" "pbcopy"
assert_contains "copy carries path"                  "$out" "notes.txt"
out="$(run finder "$PANE" "$TMP/notes.txt")";        assert_contains "finder reveals file"      "$out" "open -R"
out="$(run finder "$PANE" "$TMP/dir")";              assert_contains "finder opens dir"         "$out" "$TMP/dir"
out="$(run open "$PANE" https://example.com/x)";    assert_contains "open url -> browser"      "$out" "open"
assert_contains "browser keeps url"                  "$out" "https://example.com/x"

echo "## legacy 1-arg backward-compat ##"
out="$(run "$TMP/notes.txt")";                       assert_contains "legacy open -> nvim split" "$out" "split-window"

echo "## origin pane recorded for relative resolution ##"
out="$(run open "$PANE" notes.txt)";                 assert_contains "relative resolves from pane cwd" "$out" "$TMP/notes.txt"

echo "## hostile explicit payloads ##"
for name in "space name.txt" "quo'te.txt" 'semi;$.txt' $'tab\tname.txt' "-leading.txt"; do
  : >"$TMP/$name"
  out="$(run nvim "$PANE" "$TMP/$name" 7)"
  # The dry-run command must put every hostile filename after nvim's --;
  # `%q` may escape its display, so do not treat rendered shell text as data.
  assert_contains "safe nvim payload: $name" "$out" "--"
done

echo "## action failure propagation ##"
FAILBIN="$TMP/failbin"; mkdir -p "$FAILBIN"
cat >"$FAILBIN/open" <<'EOF'
#!/bin/sh
echo forced open failure >&2
exit 41
EOF
cat >"$FAILBIN/pbcopy" <<'EOF'
#!/bin/sh
echo forced copy failure >&2
exit 42
EOF
cat >"$FAILBIN/tmux" <<EOF
#!/bin/sh
case "\$1" in split-window) echo forced nvim failure >&2; exit 43;; esac
exec "$TMUX_BIN" -L "$SRV" "\$@"
EOF
chmod +x "$FAILBIN/open" "$FAILBIN/pbcopy" "$FAILBIN/tmux"
for action in "open https://example.com" "copy https://example.com" "finder $TMP/dir" "nvim $TMP/notes.txt"; do
  set -- $action
  set +e
  out="$(PATH="$FAILBIN:$PATH" "$TARGET" "$1" "$PANE" "$2" 2>&1)"; status=$?
  set -e
  if [ "$status" -ne 0 ]; then pass=$((pass+1)); printf 'ok   failed %s propagates\n' "$1"; else fail=$((fail+1)); printf 'FAIL failed %s was swallowed\n' "$1"; fi
  assert_contains "failed $1 reports stderr" "$out" "forced"
done

echo "## explicit errors ##"
set +e
out="$(OPEN_TARGET_DRY_RUN=1 "$TARGET" open %999999 "$TMP/notes.txt" 2>&1)"; status=$?
set -e
if [ "$status" -ne 0 ]; then pass=$((pass+1)); printf 'ok   stale pane is nonzero\n'; else fail=$((fail+1)); printf 'FAIL stale pane accepted\n'; fi
assert_contains "stale pane reports error" "$out" "invalid pane"
# A pane-looking second word remains a legacy multi-word selection, rather than
# being misclassified as a malformed explicit adapter invocation.
out="$(OPEN_TARGET_DRY_RUN=1 "$TARGET" legacy "$PANE" "$TMP/notes.txt" 2>&1)"
assert_contains "legacy multi-word selection stays legacy" "$out" "open"

echo
echo "pass=$pass fail=$fail"
[ "$fail" -eq 0 ]