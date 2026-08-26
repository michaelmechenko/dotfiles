#!/usr/bin/env bash
# Argument-boundary tests for tmux-lazygit-popup.
set -euo pipefail

ROOT=$(cd "$(dirname "$0")/.." && pwd)
SCRIPT="$ROOT/tmux_scripts/tmux-lazygit-popup"
TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT
mkdir -p "$TMP/bin" "$TMP/home with space"

cat >"$TMP/bin/tmux" <<'SH'
#!/bin/sh
if [ "$1" = "show-options" ]; then
  printf '%s\n' '#a9b1d6'
  exit 0
fi
printf '%s\n' "$@" >"$TMUX_LOG"
last=''
for arg do last=$arg; done
exec zsh -c "$last"
SH
cat >"$TMP/bin/lazygit" <<'SH'
#!/bin/sh
printf '%s\n' "$@" >"$LAZYGIT_LOG"
SH
chmod +x "$TMP/bin/tmux" "$TMP/bin/lazygit"

assert_line() {
  grep -Fqx -- "$1" "$TMUX_LOG" || {
    printf 'missing argv: %s\nactual:\n' "$1" >&2
    cat "$TMUX_LOG" >&2
    exit 1
  }
}

export PATH="$TMP/bin:$PATH" TMUX_LOG="$TMP/tmux.log" LAZYGIT_LOG="$TMP/lazygit.log"
export HOME="$TMP/home ' ; touch $TMP/PWN; echo '"
config="$HOME/.config/theme/generated/lazygit/config.yml"
"$SCRIPT"
assert_line 'popup'
assert_line '-E'
assert_line '-d'
assert_line '#{pane_current_path}'
quoted=$(zsh -c 'print -r -- ${(q)1}' -- "$config")
assert_line "lazygit --use-config-file $quoted"
if ! grep -Fqx -- "$config" "$LAZYGIT_LOG"; then
  echo 'launcher changed the config argv' >&2
  exit 1
fi
if [ -e "$TMP/PWN" ]; then
  echo 'launcher evaluated HOME through the popup command' >&2
  exit 1
fi
if grep -Fqx -- '-t' "$TMUX_LOG"; then
  echo 'no-arg launch unexpectedly targeted a client' >&2
  exit 1
fi

cwd="$TMP/cwd ' ; touch PWN"
client='/dev/tty 9; touch PWN'
: >"$TMUX_LOG"
"$SCRIPT" "$cwd" "$client"
assert_line '-d'
assert_line "$cwd"
assert_line '-t'
assert_line "$client"
if [ -e "$TMP/PWN" ]; then
  echo 'launcher evaluated a caller argument' >&2
  exit 1
fi

if "$SCRIPT" one two three >/dev/null 2>&1; then
  echo 'launcher accepted too many arguments' >&2
  exit 1
fi

echo 'tmux-lazygit-popup tests passed'
