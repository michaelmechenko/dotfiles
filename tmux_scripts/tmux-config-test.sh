#!/usr/bin/env bash
# One isolated verification entry point for the active tmux configuration.
set -euo pipefail

ROOT=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
export PYTHONDONTWRITEBYTECODE=1
export TMPDIR=/tmp

for dependency in tmux bash zsh python3 go fzf jq nnn bat; do
  command -v "$dependency" >/dev/null || { printf 'missing dependency: %s\n' "$dependency" >&2; exit 1; }
done

bash -n \
  "$ROOT/tmux_scripts/tmux-status-session-ls" \
  "$ROOT/tmux_scripts/tmux-status-pane-ls" \
  "$ROOT/tmux_scripts/tmux-claude-menu" \
  "$ROOT/tmux_scripts/tmux-sidebar-toggle" \
  "$ROOT/tmux_scripts/tmux-open-target" \
  "$ROOT/tmux_scripts/tmux-session-snapshot-test.sh"
zsh -n "$ROOT/tmux_scripts/tmux-nnn-explorer"
python3 -m py_compile \
  "$ROOT/tmux_scripts/tmux-boundary-test.py" \
  "$ROOT/tmux_scripts/tmux-status-render-test.py" \
  "$ROOT/tmux_scripts/tmux-snapshot-codec.py" \
  "$ROOT/tmux_plugins/extrakto/extrakto_plugin.py"

python3 "$ROOT/tmux_scripts/tmux-boundary-test.py"
"$ROOT/tmux_scripts/tmux-session-snapshot-test.sh"
"$ROOT/tmux_scripts/tmux-nnn-explorer-test.sh"
"$ROOT/tmux_scripts/tmux-open-target-test.sh"
python3 "$ROOT/tmux_scripts/tmux-open-picker-test.py"
python3 "$ROOT/tmux_scripts/tmux-open-picker-pty-test.py"
"$ROOT/tmux_scripts/tmux-open-picker-integration.sh"
python3 "$ROOT/tmux_scripts/tmux-flash-jump-test.py"
"$ROOT/tmux_scripts/tmux-lazygit-popup-test.sh"
"$ROOT/tmux_scripts/tmux-pi-session-test.sh"
"$ROOT/tmux_scripts/tmux-agent-action-protocol-test.sh"
"$ROOT/tmux_scripts/tmux-sidebar-build-test.sh"
"$ROOT/tmux_scripts/tmux-sidebar-repin-test.sh"
(
  cd "$ROOT/tmux_scripts/mm-sidebar"
  go test -race ./...
)
python3 "$ROOT/tmux_scripts/mm-sidebar-integration-test.py"
python3 "$ROOT/tmux_scripts/tmux-status-render-test.py"
(
  cd "$ROOT/theme"
  python3 -m unittest test_theme.BundleDriftTests test_theme.TmuxFooterTests
)

printf 'ok: complete isolated tmux verification\n'
