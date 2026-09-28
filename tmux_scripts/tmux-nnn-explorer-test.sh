#!/usr/bin/env bash
set -eu

root=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT
mkdir -p "$tmp/home/.config/nnn/plugins" "$tmp/bin"
touch "$tmp/home/.config/nnn/plugins/plugin" "$tmp/home/.config/nnn/plugins/.nnn-tmux-split" "$tmp/home/.config/nnn/plugins/.nnn-open-origin"
chmod 0444 "$tmp/home/.config/nnn/plugins/"*
cat > "$tmp/bin/tmux" <<'STUB'
#!/bin/sh
case "${1:-}" in
  display-message)
    for fmt do :; done
    case "$fmt" in
      '#{session_name}|#{@nnn_popup_token}') printf '%s\n' 'main|' ;;
      '#{session_name}') printf '%s\n' main ;;
      '#{pane_id}') printf '%s\n' %1 ;;
      '#{client_name}') printf '%s\n' /dev/pts/1 ;;
      '#{pane_current_path}') printf '%s\n' /tmp ;;
      '#{pane_width}') printf '%s\n' 100 ;;
      '#{pane_height}') printf '%s\n' 40 ;;
      *client_width*) printf '%s\n' "${TEST_CLIENT_WIDTH:?}" ;;
      *) printf '%s\n' 100 ;;
    esac ;;
  show-environment) exit 1 ;;
  show-options) printf '%s\n' '#a9b1d6' ;;
  kill-session) printf '%s\n' "$*" >>"$TEST_KILL" ;;
  popup|new-session) printf '%s\n' "$*" > "$TEST_CAPTURE" ;;
  *) : ;;
esac
STUB
chmod +x "$tmp/bin/tmux"
run_case() {
  width=$1 expected=$2
  : >"$tmp/kill"
  TEST_CLIENT_WIDTH=$width TEST_CAPTURE="$tmp/capture" TEST_KILL="$tmp/kill" PATH="$tmp/bin:$PATH" HOME="$tmp/home" \
    zsh "$root/tmux_scripts/tmux-nnn-explorer" || {
    echo "launcher failed at width $width" >&2
    exit 1
  }
  [ ! -s "$tmp/kill" ] || { echo 'launcher killed an unrelated nnn session' >&2; exit 1; }
  grep -Eq 'NNN_POPUP_SESSION=nnn-popup-[0-9]+-[0-9]+-[0-9]+' "$tmp/capture" || { echo 'popup session is not launch-unique' >&2; exit 1; }
  grep -Fq "NNN_SPLIT=$expected" "$tmp/capture" || {
    echo "width $width did not select NNN_SPLIT=$expected" >&2
    cat "$tmp/capture" >&2
    exit 1
  }
}
run_case 159 h
run_case 160 v
run_case 240 v
TEST_CLIENT_WIDTH=160 TEST_CAPTURE="$tmp/capture" TEST_KILL="$tmp/kill" PATH="$tmp/bin:$PATH" HOME="$tmp/home" \
  zsh "$root/tmux_scripts/tmux-nnn-explorer" pane %9
if ! grep -Fq -- '-t %9' "$tmp/capture"; then
  echo 'explicit origin pane was not preserved' >&2
  cat "$tmp/capture" >&2
  exit 1
fi
TEST_CAPTURE="$tmp/inner" PATH="$tmp/bin:$PATH" \
  NNN_POPUP_SESSION=nnn-popup-test NNN_POPUP_TOKEN=owner-test \
  NNN_ORIGIN_PANE=%9 NNN_PLUG=p NNN_SPLIT=v NNN_SPLITSIZE=70 \
  NNN_BATSTYLE=numbers NNN_BATTHEME=ansi NNN_COLORS=1 NNN_FCOLORS=2 \
  NNN_PAGER=less NNN_MUTED_HEX='#fff' FZF_DEFAULT_OPTS='' RG_COLORS='' NNN_CWD=/tmp \
  zsh "$root/tmux_scripts/tmux-nnn-explorer" --inner
grep -Fq -- 'new-session -s nnn-popup-test' "$tmp/inner"
grep -Fq -- 'NNN_POPUP_TOKEN=owner-test' "$tmp/inner"
grep -Fq -- ' --session' "$tmp/inner"
printf 'ok: M-d split threshold and immutable plugin launch\n'
