#!/bin/sh
# Regression test: tmux-sidebar-build must replace a newer-but-unrunnable binary.

set -eu

ROOT=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
FIXTURE=$(mktemp -d "${TMPDIR:-/tmp}/mm-sidebar-build-test.XXXXXX")
trap 'chmod -R u+w "$FIXTURE" 2>/dev/null || true; rm -rf "$FIXTURE"' EXIT INT TERM

HOME_DIR="$FIXTURE/home"
MODULE="$HOME_DIR/.config/tmux_scripts/mm-sidebar"
GOMODCACHE=$(go env GOMODCACHE)
GOCACHE=$(go env GOCACHE)
mkdir -p "$(dirname "$MODULE")"
cp -R "$ROOT/mm-sidebar" "$MODULE"
rm -f "$MODULE/mm-sidebar" "$MODULE"/mm-sidebar.tmp.* "$MODULE"/mm-sidebar.probe.*

BIN=$(HOME="$HOME_DIR" GOMODCACHE="$GOMODCACHE" GOCACHE="$GOCACHE" "$ROOT/tmux-sidebar-build")
"$BIN" --help >/dev/null 2>&1

# Replace the artifact with a deterministically unrunnable stand-in while keeping
# it executable and newer than every source. This exercises the same missed state
# as the stale invalid Mach-O that macOS killed before its first frame.
cat >"$BIN" <<'BROKEN'
#!/bin/sh
exit 70
BROKEN
chmod +x "$BIN"
BAD_HASH=$(shasum -a 256 "$BIN" | awk '{print $1}')

REBUILT=$(HOME="$HOME_DIR" GOMODCACHE="$GOMODCACHE" GOCACHE="$GOCACHE" "$ROOT/tmux-sidebar-build")
NEW_HASH=$(shasum -a 256 "$REBUILT" | awk '{print $1}')

if [ "$NEW_HASH" = "$BAD_HASH" ]; then
    echo "tmux-sidebar-build did not replace an unrunnable binary" >&2
    exit 1
fi
"$REBUILT" --help >/dev/null 2>&1

# Freshness must recurse beyond the historical internal/*/*.go glob. This
# package is intentionally unimported: the build only needs the source mtime,
# not a new production dependency.
mkdir -p "$MODULE/internal/freshness/deep"
sleep 1
cat >"$MODULE/internal/freshness/deep/freshness.go" <<'SOURCE'
package deep
SOURCE
NESTED_REBUILT=$(HOME="$HOME_DIR" GOMODCACHE="$GOMODCACHE" GOCACHE="$GOCACHE" "$ROOT/tmux-sidebar-build")
if [ "$NESTED_REBUILT" -ot "$MODULE/internal/freshness/deep/freshness.go" ]; then
    echo "tmux-sidebar-build ignored a nested Go source file" >&2
    exit 1
fi
"$NESTED_REBUILT" --help >/dev/null 2>&1
