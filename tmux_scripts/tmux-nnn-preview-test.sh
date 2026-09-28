#!/usr/bin/env bash
# Exercise the actual preview-tui producer on a disposable tmux server.
set -euo pipefail
root=$(cd "$(dirname "$0")/.." && pwd)
tmp=$(mktemp -d)
socket="$tmp/socket"
cleanup() {
  tmux -S "$socket" kill-server 2>/dev/null || true
  rm -rf "$tmp"
}
trap cleanup EXIT
mkdir -p "$tmp/bin" "$tmp/home" "$tmp/work" "$tmp/maps"
printf 'preview fixture\n' > "$tmp/work/file.txt"
cat > "$tmp/bin/file" <<'SH'
#!/usr/bin/env sh
case "$2" in --mime-encoding) echo utf-8 ;; *) echo text/plain ;; esac
SH
chmod +x "$tmp/bin/file"
mkfifo "$tmp/nnn.fifo.12345"
cat > "$tmp/bin/tmux" <<'SH'
#!/usr/bin/env bash
exec "${TMUX_REAL:?}" -S "${TMUX_TEST_SOCKET:?}" "$@"
SH
chmod +x "$tmp/bin/tmux"
cat > "$tmp/origin.sh" <<'SH'
#!/usr/bin/env bash
cd "$TEST_WORK"
NNN_FIFO="$TEST_FIFO" NNN_TERMINAL=tmux NNN_SPLIT=v NNN_SPLITSIZE=40 NNN_PAGER=cat \
  "$TEST_PREVIEW" file.txt
# Keep the origin pane alive while the detached preview runs.
sleep 15
SH
chmod +x "$tmp/origin.sh"
export TMUX_REAL="$(command -v tmux)" TMUX_TEST_SOCKET="$socket"
export TEST_FIFO="$tmp/nnn.fifo.12345" TEST_WORK="$tmp/work" TEST_PREVIEW="$root/nnn/plugins/preview-tui"
export TMPDIR="$tmp/maps" HOME="$tmp/home" PATH="$tmp/bin:$PATH" TERM=xterm-256color
"$TMUX_REAL" -S "$socket" -f /dev/null new-session -d -s preview "$tmp/origin.sh"
origin=$("$TMUX_REAL" -S "$socket" display-message -p -t preview '#{pane_id}')
server_id=$("$TMUX_REAL" -S "$socket" display-message -p -t preview '#{pid}')
map="$TMPDIR/nnn-preview-panes/$server_id/$origin"
for _ in $(seq 1 80); do [ -s "$map" ] && break; sleep .1; done
[ -s "$map" ] || { echo 'preview producer failed to publish a pane mapping' >&2; exit 1; }
preview=$(cat "$map")
[ "$("$TMUX_REAL" -S "$socket" display-message -p -t "$preview" '#{@nnn_preview}|#{window_id}')" = "1|$("$TMUX_REAL" -S "$socket" display-message -p -t "$origin" '#{window_id}')" ]
TMUX="$socket,$server_id,0" TMUX_PANE="$origin" TMPDIR="$tmp/maps" \
  "$root/nnn/plugins/.nnn-preview-scroll" down
# A successful cleanup also proves the child received NNN_PREVIEW_MAP via -e.
# The child owns the mapping and removes it when its pane exits.
"$TMUX_REAL" -S "$socket" send-keys -t "$preview" C-c
for _ in $(seq 1 80); do [ ! -e "$map" ] && break; sleep .1; done
[ ! -e "$map" ] || { echo 'preview producer failed to clean up mapping' >&2; "$TMUX_REAL" -S "$socket" list-panes -a -F '#{pane_id} #{pane_current_command}' >&2; "$TMUX_REAL" -S "$socket" capture-pane -p -t "$preview" >&2 || true; exit 1; }
printf 'ok: real tmux preview split, marking, mapping, and cleanup\n'
