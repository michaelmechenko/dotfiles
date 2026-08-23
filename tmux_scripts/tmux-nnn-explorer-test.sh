#!/bin/bash
set -eu

root=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT
mkdir -p "$tmp/home/.config/nnn/plugins" "$tmp/bin"
touch "$tmp/home/.config/nnn/plugins/plugin" "$tmp/home/.config/nnn/plugins/.nnn-tmux-split" "$tmp/home/.config/nnn/plugins/.nnn-open-origin"
cat > "$tmp/bin/tmux" <<'STUB'
#!/bin/sh
case "${1:-}" in
  display-message)
    case "${3:-}" in
      '#{session_name}') printf '%s\n' main ;;
      '#{pane_id}') printf '%s\n' %1 ;;
      '#{pane_current_path}') printf '%s\n' /tmp ;;
      '#{pane_width}') printf '%s\n' 100 ;;
      '#{pane_height}') printf '%s\n' 40 ;;
      *client_width*) printf '%s\n' "${TEST_CLIENT_WIDTH:?}" ;;
      *) printf '%s\n' 100 ;;
    esac ;;
  show-environment) exit 1 ;;
  show-options) printf '%s\n' '#a9b1d6' ;;
  kill-session) exit 0 ;;
  popup) printf '%s\n' "$*" > "$TEST_CAPTURE" ;;
  *) : ;;
esac
STUB
chmod +x "$tmp/bin/tmux"
run_case() {
  width=$1 expected=$2
  TEST_CLIENT_WIDTH=$width TEST_CAPTURE="$tmp/capture" PATH="$tmp/bin:$PATH" HOME="$tmp/home" \
    zsh "$root/tmux_scripts/tmux-nnn-explorer" || {
    echo "launcher failed at width $width" >&2
    exit 1
  }
  grep -Fq "NNN_SPLIT=$expected" "$tmp/capture" || {
    echo "width $width did not select NNN_SPLIT=$expected" >&2
    cat "$tmp/capture" >&2
    exit 1
  }
}
run_case 159 h
run_case 160 v
run_case 240 v
printf 'ok: M-d split threshold\n'
