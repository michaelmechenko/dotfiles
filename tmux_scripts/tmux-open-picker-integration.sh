#!/usr/bin/env bash
# Integration: capture_pane + extract_urls/extract_path_candidates against a
# real throwaway tmux server, plus the sidebar's legacy TMUX_OPEN_PANE open path.
# Run: bash tmux_scripts/tmux-open-picker-integration.sh
set -u

CONF="$HOME/.config/tmux_scripts"
PICKER="$CONF/tmux-open-picker"
TARGET="$CONF/tmux-open-target"
SRV="openpickint$$"
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

pass=0; fail=0
ok()   { pass=$((pass+1)); printf 'ok   %s\n' "$1"; }
bad()  { fail=$((fail+1)); printf 'FAIL %s\n  %s\n' "$1" "${2:-}"; }
cleanup() { tmux -L "$SRV" kill-server 2>/dev/null; rm -rf "$TMP"; }
trap cleanup EXIT

# fixture tree
mkdir -p "$TMP/src" "$TMP/docs" "$TMP/lib"
: >"$TMP/notes.txt"; : >"$TMP/src/main.rs"
: >"$TMP/docs/my file.md"; : >"$TMP/Makefile"; : >"$TMP/.zshrc"
: >"$TMP/lib/utils.rs"; : >"$TMP/lib/helper.rs"

# fixture content printed into the pane via `cat` (preserves quotes verbatim)
FX="$TMP/fixture.txt"
cat >"$FX" <<'EOF'
visit https://example.com/docs?q=1
see src/main.rs:42:7
open ./notes.txt
cd docs/
make Makefile
source .zshrc
edit "docs/my file.md"
git@github.com:u/r.git
missing/nope.rs
www.foo.bar/x
2.2.2.2:9
README
see (lib/utils.rs) here
open lib/helper.rs,
error at [src/main.rs:99]
EOF

tmux -L "$SRV" new-session -d -s s -x 200 -y 50 -c "$TMP" 2>/dev/null
PANE="$(tmux -L "$SRV" display -p '#{pane_id}')"

tmux -L "$SRV" send-keys -t "$PANE" "cat $FX" Enter
# wait for the fixture content to actually appear in the pane (cat can lag)
for _ in $(seq 1 40); do
  if tmux -L "$SRV" capture-pane -t "$PANE" -p | grep -qF 'https://example.com'; then break; fi
  sleep 0.05
done

# run extraction against the real captured pane (shim makes bare `tmux` reach the server)
read -r -d '' PY <<'PY' || true
import importlib.machinery, importlib.util, os, sys
HERE = os.path.abspath(sys.argv[1])
M = os.path.join(HERE, "tmux-open-picker")
loader = importlib.machinery.SourceFileLoader("p", M)
spec = importlib.util.spec_from_loader("p", loader)
mod = importlib.util.module_from_spec(spec); loader.exec_module(mod)
pane = sys.argv[2]
raw = mod.capture_pane(pane)
urls = mod.extract_urls(raw)
paths = mod.extract_path_candidates(raw, mod.pane_cwd(pane))
print("URL_COUNT", len(urls))
for u in urls: print("URL", u)
print("PATH_COUNT", len(paths))
for p in paths: print("PATH", p["display"], p["line"] or "-", "dir" if p["is_dir"] else "file")
PY

OUT="$(python3 -c "$PY" "$CONF" "$PANE" 2>&1)"
echo "$OUT" | grep -qF 'URL https://example.com/docs?q=1' && ok "real capture: https url" || bad "https url" "$OUT"
echo "$OUT" | grep -qF 'URL https://github.com/u/r.git' && ok "real capture: git ssh" || bad "git ssh" "$OUT"
echo "$OUT" | grep -qF 'URL http://www.foo.bar/x' && ok "real capture: www" || bad "www" "$OUT"
echo "$OUT" | grep -qF 'URL http://2.2.2.2:9' && ok "real capture: ip" || bad "ip" "$OUT"
echo "$OUT" | grep -E '^PATH src/main.rs:42:7 42 file$' >/dev/null && ok "real capture: relative file+line" || bad "relative file+line" "$OUT"
echo "$OUT" | grep -E '^PATH \./notes.txt - file$' >/dev/null && ok "real capture: dot-slash relative" || bad "dot-slash" "$OUT"
echo "$OUT" | grep -E '^PATH docs/my file.md - file$' >/dev/null && ok "real capture: quoted space" || bad "quoted space" "$OUT"
echo "$OUT" | grep -E '^PATH Makefile - file$' >/dev/null && ok "real capture: extensionless" || bad "extensionless" "$OUT"
echo "$OUT" | grep -E '^PATH .zshrc - file$' >/dev/null && ok "real capture: hidden" || bad "hidden" "$OUT"
echo "$OUT" | grep -E '^PATH docs/ - dir$' >/dev/null && ok "real capture: directory" || bad "directory" "$OUT"
echo "$OUT" | grep -E '^PATH ' | grep -qF 'nope' && bad "nonexistent leaked into paths" "$OUT" || ok "nonexistent omitted from paths"
echo "$OUT" | grep -E '^PATH ' | grep -qF 'README' && bad "nonexistent bare name leaked" "$OUT" || ok "nonexistent bare name omitted"

# punctuation-wrapped paths: (lib/utils.rs) and lib/utils.rs, resolve to the same file.
# src/main.rs:42:7 already resolves to $TMP/src/main.rs, so [src/main.rs:99] is deduped —
# verify the paren-wrapped lib path appears instead.
echo "$OUT" | grep -E '^PATH \(lib/utils\.rs\) - file$' >/dev/null && ok "real capture: paren-wrapped path" || bad "paren-wrapped" "$OUT"
echo "$OUT" | grep -E '^PATH lib/helper\.rs, - file$' >/dev/null && ok "real capture: trailing-comma path" || bad "trailing-comma path" "$OUT"

# multi-root: a subpane whose cwd is $TMP/lib should resolve src/main.rs via the
# parent $TMP (path contains / so the parent chain is tried).
SUBPANE="$(tmux -L "$SRV" split-window -t "$PANE" -c "$TMP/lib" -P -F '#{pane_id}')"
tmux -L "$SRV" send-keys -t "$SUBPANE" "echo src/main.rs" Enter
for _ in $(seq 1 20); do
  if tmux -L "$SRV" capture-pane -t "$SUBPANE" -p | grep -qF 'src/main.rs'; then break; fi
  sleep 0.05
done
OUT2="$(python3 -c "$PY" "$CONF" "$SUBPANE" 2>&1)"
echo "$OUT2" | grep -E '^PATH src/main\.rs - file$' >/dev/null && ok "multi-root: path resolves via parent from subpane" || bad "multi-root parent" "$OUT2"

# URL copy: tmux-open-target copy <pane> <url> -> pbcopy (dry-run)
COUT="$(OPEN_TARGET_DRY_RUN=1 "$TARGET" copy "$PANE" https://example.com/x 2>&1)"
echo "$COUT" | grep -qF 'pbcopy' && ok "url copy -> pbcopy" || bad "url copy pbcopy" "$COUT"
echo "$COUT" | grep -qF 'https://example.com/x' && ok "url copy carries url" || bad "url copy carries url" "$COUT"

# sidebar legacy path: TMUX_OPEN_PANE set + single path arg -> nvim split (dry-run)
export TMUX_OPEN_PANE="$PANE"
LOUT="$(OPEN_TARGET_DRY_RUN=1 "$TARGET" "$TMP/src/main.rs" 2>&1)"
echo "$LOUT" | grep -qF 'split-window' && ok "sidebar legacy open -> nvim split" || bad "sidebar legacy" "$LOUT"
unset TMUX_OPEN_PANE

# The picker itself owns popup creation. Its command receives the explicit pane
# only once and carries it privately into the popup inner mode.
LAUNCH_LOG="$TMP/launcher.log"
FAKE_LAUNCH="$TMP/fake-launch"
mkdir -p "$FAKE_LAUNCH"
cat >"$FAKE_LAUNCH/tmux" <<EOF
#!/bin/sh
printf '%s\\n' "\$@" >"$LAUNCH_LOG"
EOF
chmod +x "$FAKE_LAUNCH/tmux"
PATH="$FAKE_LAUNCH:$PATH" "$PICKER" "$PANE"
if grep -Fxq 'display-popup' "$LAUNCH_LOG" 2>/dev/null && \
   grep -Fq -- "--inner $PANE" "$LAUNCH_LOG" 2>/dev/null; then
  ok "picker owns popup with explicit private origin"
else
  bad "picker popup origin" "$(cat "$LAUNCH_LOG" 2>/dev/null)"
fi

# A pane may disappear after outer launch; inner mode must report nonzero rather
# than silently detaching through a background action.
set +e
STALE_OUT="$("$PICKER" --inner %999999 2>&1)"; STALE_STATUS=$?
set -e
[ "$STALE_STATUS" -ne 0 ] && ok "stale pane inner exits nonzero" || bad "stale pane inner accepted" "$STALE_OUT"

# Actual attached-client transport: tmux must recognize Ghostty's CSI-u Alt+O
# sequence as the M-o root binding, not merely accept a synthetic send-keys.
CSI_LOG="$TMP/csi-o.log"
tmux -L "$SRV" set -g extended-keys on
tmux -L "$SRV" set -g extended-keys-format csi-u
tmux -L "$SRV" bind-key -n M-o run-shell "printf hit > '$CSI_LOG'"
TMUX_BIN="$TMUX_BIN" TMUX_SOCKET="$SRV" TMUX_SESSION=s CSI_LOG="$CSI_LOG" python3 - <<'PY2'
import os, pty, time
pid, fd = pty.fork()
if pid == 0:
    os.execvp(os.environ["TMUX_BIN"], [os.environ["TMUX_BIN"], "-L", os.environ["TMUX_SOCKET"], "attach", "-t", os.environ["TMUX_SESSION"]])
time.sleep(.4)
os.write(fd, b"\x1b[111;3u")
deadline = time.time() + 3
while time.time() < deadline and not os.path.exists(os.environ["CSI_LOG"]):
    time.sleep(.05)
os.write(fd, b"\x02d")
for _ in range(30):
    child, _status = os.waitpid(pid, os.WNOHANG)
    if child == pid:
        break
    time.sleep(.05)
else:
    os.kill(pid, 9)
    os.waitpid(pid, 0)
PY2
[ -f "$CSI_LOG" ] && ok "attached CSI-u Alt+O reaches M-o" || bad "CSI-u Alt+O was not recognized"

echo
echo "pass=$pass fail=$fail"
[ "$fail" -eq 0 ]
