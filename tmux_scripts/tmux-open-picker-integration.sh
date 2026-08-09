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
mkdir -p "$TMP/src" "$TMP/docs"
: >"$TMP/notes.txt"; : >"$TMP/src/main.rs"
: >"$TMP/docs/my file.md"; : >"$TMP/Makefile"; : >"$TMP/.zshrc"

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

# sidebar legacy path: TMUX_OPEN_PANE set + single path arg -> nvim split (dry-run)
export TMUX_OPEN_PANE="$PANE"
LOUT="$(OPEN_TARGET_DRY_RUN=1 "$TARGET" "$TMP/src/main.rs" 2>&1)"
echo "$LOUT" | grep -qF 'split-window' && ok "sidebar legacy open -> nvim split" || bad "sidebar legacy" "$LOUT"
unset TMUX_OPEN_PANE

echo
echo "pass=$pass fail=$fail"
[ "$fail" -eq 0 ]