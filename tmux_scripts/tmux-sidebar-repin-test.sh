#!/bin/sh
# Regression coverage for batched/coalesced sidebar width repair.
set -eu

ROOT=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
FIXTURE=$(mktemp -d "${TMPDIR:-/tmp}/tmux-sidebar-repin-test.XXXXXX")
trap 'rm -rf "$FIXTURE"' EXIT INT TERM
mkdir -p "$FIXTURE/bin" "$FIXTURE/tmp"
LOG="$FIXTURE/log"
READY="$FIXTURE/ready"

cat >"$FIXTURE/bin/tmux" <<'FAKE'
#!/bin/sh
case "$1" in
list-panes)
    printf 'list\n' >>"$REPIN_LOG"
    : >"$REPIN_READY"
    sleep "${REPIN_LIST_DELAY:-0}"
    printf '%%sidebar-a\t24\t120\t1\t44\n%%content\t84\t120\t\t\n%%sidebar-b\t36\t120\t1\t\n'
    ;;
resize-pane)
    printf 'resize %s\n' "$*" >>"$REPIN_LOG"
    ;;
*)
    printf 'unexpected %s\n' "$*" >>"$REPIN_LOG"
    exit 1
    ;;
esac
FAKE
chmod +x "$FIXTURE/bin/tmux"

run() {
    PATH="$FIXTURE/bin:$PATH" TMPDIR="$FIXTURE/tmp" REPIN_LOG="$LOG" REPIN_READY="$READY" \
        REPIN_LIST_DELAY="${1:-0}" "$ROOT/tmux-sidebar-repin"
}

# One pass must use one list-panes batch and no display-message probes.
run
[ "$(grep -c '^list$' "$LOG")" -eq 1 ]
grep -q '^resize resize-pane -x 44 -t %sidebar-a$' "$LOG"
! grep -q 'unexpected\|display-message' "$LOG"

# A process killed after mkdir but before publishing its pid must not wedge all
# future resize repairs. The next invocation reclaims that uninitialized lock.
uid=${UID:-$(id -u)}
stale="$FIXTURE/tmp/tmux-sidebar-repin.${uid}.default.lock"
mkdir "$stale"
: >"$LOG"
run
[ "$(grep -c '^list$' "$LOG")" -eq 1 ]
[ ! -e "$stale" ]


# Concurrent hook invocations are coalesced: one owner performs an initial pass,
# then one dirty follow-up; they do not each walk all panes independently.
: >"$LOG"
rm -f "$READY"
run .2 &
first=$!
while [ ! -e "$READY" ]; do sleep .01; done
run .2 &
second=$!
run .2 &
third=$!
wait "$first"
wait "$second"
wait "$third"
[ "$(grep -c '^list$' "$LOG")" -eq 2 ]
[ "$(grep -c '^resize ' "$LOG")" -eq 2 ]
! grep -q 'unexpected\|display-message' "$LOG"
