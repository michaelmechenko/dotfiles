#!/usr/bin/env bash
# Isolated integration tests for frontapps.sh. All AeroSpace/SketchyBar calls are stubs.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
PLUGIN="$ROOT/sketchybar/plugins/frontapps.sh"
WORK="$(mktemp -d)"
HOME_DIR="$WORK/home"
RUNTIME="$WORK/runtime"
STUB="$WORK/bin"
LOG="$WORK/sketchybar.log"
QUERY_LOG="$WORK/aerospace.log"
BAR_STATE="$WORK/bar-state"
mkdir -p "$HOME_DIR/.config/theme/active/sketchybar" "$RUNTIME" "$STUB"
trap 'rm -rf "$WORK"' EXIT

cat > "$HOME_DIR/.config/theme/active/sketchybar/colors.sh" <<'EOF'
export THEME_BAR_TEXT="0xFFEEEEEE"
export THEME_BAR_TEXT_INACTIVE="0x80EEEEEE"
EOF

cat > "$STUB/aerospace" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail
printf '%s\n' "$*" >> "$TEST_QUERY_LOG"
[ -z "${TEST_AEROSPACE_DELAY:-}" ] || sleep "$TEST_AEROSPACE_DELAY"
if [ "$1" = "list-windows" ] && [ "$2" = "--focused" ]; then
  [ "${TEST_AEROSPACE_FAIL:-}" = "focused" ] && exit 1
  [ "${TEST_AEROSPACE_FOCUSED_STATUS:-0}" = "0" ] || exit "$TEST_AEROSPACE_FOCUSED_STATUS"
  printf '%s\n' "${TEST_AEROSPACE_FOCUSED:-}"
  exit 0
fi
[ "${TEST_AEROSPACE_FAIL:-}" = "all" ] && exit 1
printf '%s\n' "${TEST_AEROSPACE_ALL:-}"
EOF

# Minimal SketchyBar state model. It applies a command left-to-right and rejects the
# operations the real bar rejects: setting or moving an identity that does not exist,
# adding a duplicate, or moving relative to a missing anchor.
cat > "$STUB/sketchybar" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail
printf '%s|' "$@" >> "$TEST_SKETCHYBAR_LOG"
printf '\n' >> "$TEST_SKETCHYBAR_LOG"
state="$TEST_SKETCHYBAR_STATE"
contains() { grep -Fx -- "$1" "$state" >/dev/null; }
remove_item() { grep -Fvx -- "$1" "$state" > "$state.next" || true; mv "$state.next" "$state"; }
move_before() {
  local id=$1 anchor=$2
  grep -Fvx -- "$id" "$state" > "$state.next" || true
  awk -v id="$id" -v anchor="$anchor" '{ if ($0 == anchor) print id; print }' "$state.next" > "$state"
  rm -f "$state.next"
}
remove_dynamic() {
  awk '$0 !~ /^frontapps_(ws|app)_/' "$state" > "$state.next"
  mv "$state.next" "$state"
}
apply_count=0
apply() {
  apply_count=$((apply_count + 1))
  if [ "${TEST_SKETCHYBAR_FAIL_AFTER:-0}" -gt 0 ] && [ "$apply_count" -ge "$TEST_SKETCHYBAR_FAIL_AFTER" ]; then
    exit 1
  fi
}
args=("$@")
i=0
while [ "$i" -lt "${#args[@]}" ]; do
  case "${args[$i]}" in
    --add)
      [ "${args[$((i + 1))]}" = item ] || { echo 'bad add' >&2; exit 2; }
      id="${args[$((i + 2))]}"
      contains "$id" && { echo "duplicate add: $id" >&2; exit 2; }
      printf '%s\n' "$id" >> "$state"
      apply
      i=$((i + 4))
      ;;
    --remove)
      id="${args[$((i + 1))]}"
      case "$id" in
        '/^frontapps_ws_.'*|'/^frontapps_app_.'*) remove_dynamic ;;
        *) remove_item "$id" ;;
      esac
      apply
      i=$((i + 2))
      ;;
    --set)
      id="${args[$((i + 1))]}"
      contains "$id" || { echo "set missing: $id" >&2; exit 2; }
      apply
      i=$((i + 2))
      while [ "$i" -lt "${#args[@]}" ] && [[ "${args[$i]}" != --* ]]; do i=$((i + 1)); done
      ;;
    --move)
      id="${args[$((i + 1))]}"
      anchor="${args[$((i + 3))]}"
      contains "$id" || { echo "move missing: $id" >&2; exit 2; }
      contains "$anchor" || { echo "move anchor missing: $anchor" >&2; exit 2; }
      move_before "$id" "$anchor"
      apply
      i=$((i + 4))
      ;;
    *) echo "unexpected SketchyBar argument: ${args[$i]}" >&2; exit 2 ;;
  esac
done
EOF
# The teardown-boundary regression pauses the owner after it has checked for a
# request, but before it drops the lock directory. This is synchronization, not a
# timing race: a concurrent contender must be durably handed back for one render.
cat > "$STUB/rmdir" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail
if [ "${1:-}" = "${TEST_FRONTAPPS_LOCK:-}" ] && [ -n "${TEST_TEARDOWN_SYNC:-}" ] && [ ! -e "$TEST_TEARDOWN_SYNC.used" ]; then
  : > "$TEST_TEARDOWN_SYNC.used"
  : > "$TEST_TEARDOWN_SYNC.ready"
  while [ ! -e "$TEST_TEARDOWN_SYNC.release" ]; do sleep 0.01; done
fi
exec /bin/rmdir "$@"
EOF
chmod +x "$STUB/aerospace" "$STUB/sketchybar" "$STUB/rmdir"

export TEST_QUERY_LOG="$QUERY_LOG" TEST_SKETCHYBAR_LOG="$LOG" TEST_SKETCHYBAR_STATE="$BAR_STATE"
export HOME="$HOME_DIR" TMPDIR="$RUNTIME" PATH="$STUB:$PATH"

fail() { printf 'FAIL: %s\n' "$*" >&2; exit 1; }
contains() { grep -F -- "$2" "$1" >/dev/null || fail "missing $2"; }
not_contains() { ! grep -F -- "$2" "$1" >/dev/null || fail "unexpected $2"; }
run() { "$PLUGIN" "${@:-}"; }
wait_for_file() {
  local file=$1 attempts=0
  while [ ! -e "$file" ] && [ "$attempts" -lt 200 ]; do
    sleep 0.01
    attempts=$((attempts + 1))
  done
  [ -e "$file" ] || fail "timed out waiting for $file"
}
clear_log() { : > "$LOG"; }
reset_bar() { printf 'keyswap\n' > "$BAR_STATE"; }
assert_order() {
  printf '%s\n' "$1" > "$WORK/expected-order"
  cmp -s "$WORK/expected-order" "$BAR_STATE" || {
    printf 'expected order:\n'; cat "$WORK/expected-order"
    printf 'actual order:\n'; cat "$BAR_STATE"
    fail 'final item ordering differs'
  }
}
cache_state="$RUNTIME/sketchybar_frontapps/state"

# The hidden event driver must not allocate a visible/native item.
grep -F 'frontapps.sh" --reset-cache' "$ROOT/sketchybar/sketchybarrc.full" >/dev/null || fail 'profile cache reset missing'
grep -F 'frontapps_driver drawing=off icon.drawing=off label.drawing=off' "$ROOT/sketchybar/sketchybarrc.full" >/dev/null || fail 'hidden driver is drawable'
reset_bar
run --reset-cache
[ ! -e "$cache_state" ] || fail 'reset left a cache state'
assert_order 'keyswap'

# 8 workspaces and 7 apps in 1*: retain existing sort, the 7-workspace cap, and 6-app cap.
export TEST_AEROSPACE_FOCUSED=11
TEST_AEROSPACE_ALL="$(cat <<'EOF'
1*	true	11	Alpha	false	tiling
1*	true	12	Beta	true	tiling
1*	true	13	Gamma	false	tiling
1*	true	14	Delta	false	tiling
1*	true	15	Epsilon	false	tiling
1*	true	16	Zeta	false	tiling
1*	true	17	Dropped	false	tiling
2*	false	21	Two	false	tiling
3*	false	31	Three	false	tiling
4*	false	41	Four	false	tiling
5*	false	51	Five	false	tiling
6*	false	61	Six	false	tiling
7*	false	71	Seven	false	tiling
8*	false	81	Eight	false	tiling
EOF
)"
export TEST_AEROSPACE_ALL
clear_log
run
contains "$LOG" 'frontapps_ws_1_star'
contains "$LOG" 'frontapps_ws_7_star'
not_contains "$LOG" 'frontapps_ws_8_star'
contains "$LOG" 'frontapps_app_16'
not_contains "$LOG" 'frontapps_app_17'
contains "$LOG" 'frontapps_app_12|drawing=on|icon.drawing=on|icon=~|icon.color=0x80EEEEEE|icon.padding_left=4|icon.padding_right=4'
contains "$LOG" 'label=[beta]'
contains "$LOG" 'click_script=aerospace focus --window-id 12'
[ "$(tail -n 1 "$BAR_STATE")" = keyswap ] || fail 'dynamic items did not precede keyswap'
clear_log
run
[ ! -s "$LOG" ] || fail 'unchanged populated state wrote to SketchyBar'

# A newly introduced workspace/app must be added, then ordered before existing items.
export TEST_AEROSPACE_FOCUSED=21
export TEST_AEROSPACE_ALL=$'2*\ttrue\t21\tTwo\tfalse\ttiling'
run --reset-cache
run
export TEST_AEROSPACE_ALL=$'1*\tfalse\t11\tOne\tfalse\ttiling\n2*\ttrue\t21\tTwo\tfalse\ttiling\n2*\ttrue\t22\tNew\tfalse\ttiling'
clear_log
run
contains "$LOG" '--add|item|frontapps_ws_1_star|left'
contains "$LOG" '--add|item|frontapps_app_22|left'
assert_order "$(cat <<'EOF'
frontapps_ws_1_star
frontapps_app_11
frontapps_ws_2_star
frontapps_app_21
frontapps_app_22
keyswap
EOF
)"

# Empty state removes every dynamic identity. A failed focused lookup is still an
# intentional empty state when the all-windows query succeeds.
export TEST_AEROSPACE_FOCUSED='' TEST_AEROSPACE_ALL=''
clear_log
run
assert_order 'keyswap'
export TEST_AEROSPACE_FOCUSED_STATUS=1
clear_log
run
[ ! -s "$LOG" ] || fail 'repeated no-focused empty state wrote to SketchyBar'
unset TEST_AEROSPACE_FOCUSED_STATUS

# Focus, fullscreen label, and palette mutations alter only desired properties.
export TEST_AEROSPACE_FOCUSED=11
export TEST_AEROSPACE_ALL=$'1*\ttrue\t11\tOne\tfalse\ttiling\n1*\ttrue\t12\tTwo\ttrue\ttiling'
run
export TEST_AEROSPACE_FOCUSED=12
clear_log
run
contains "$LOG" '--set|frontapps_app_11|'
contains "$LOG" '--set|frontapps_app_12|'
contains "$LOG" 'label=[two]'
sed -i.bak 's/0xFFEEEEEE/0xFFAAAAAA/g; s/0x80EEEEEE/0x80555555/g' "$HOME_DIR/.config/theme/active/sketchybar/colors.sh"
clear_log
run
contains "$LOG" 'label.color=0xFFAAAAAA'
contains "$LOG" 'icon.color=0x80555555'

# Failed all-windows queries retain the cache and bar. A partial apply leaves a marker;
# the next event removes dynamic IDs before rebuilding, avoiding duplicate --add calls.
cp "$cache_state" "$WORK/state-before-query"
cp "$BAR_STATE" "$WORK/bar-before-query"
export TEST_AEROSPACE_FAIL=all
clear_log
run
cmp -s "$cache_state" "$WORK/state-before-query" || fail 'failed query advanced cache'
cmp -s "$BAR_STATE" "$WORK/bar-before-query" || fail 'failed query changed bar'
[ ! -s "$LOG" ] || fail 'failed query changed SketchyBar'
unset TEST_AEROSPACE_FAIL

# Add a third app so an apply can fail after its first mutation (the new --add).
export TEST_AEROSPACE_FOCUSED=11
export TEST_AEROSPACE_ALL=$'1*\ttrue\t11\tOne\tfalse\ttiling\n1*\ttrue\t12\tTwo\ttrue\ttiling\n1*\ttrue\t13\tThree\tfalse\ttiling'
export TEST_SKETCHYBAR_FAIL_AFTER=1
clear_log
run
unset TEST_SKETCHYBAR_FAIL_AFTER
[ -e "$RUNTIME/sketchybar_frontapps/failed" ] || fail 'partial apply did not invalidate cache'
clear_log
run
contains "$LOG" "--remove|/^frontapps_ws_.*/|--remove|/^frontapps_app_.*/"
contains "$LOG" '--add|item|frontapps_app_13|left'
[ ! -e "$RUNTIME/sketchybar_frontapps/failed" ] || fail 'successful recovery retained invalidation'
assert_order "$(cat <<'EOF'
frontapps_ws_1_star
frontapps_app_11
frontapps_app_12
frontapps_app_13
keyswap
EOF
)"

# Reset serializes with an in-flight event; when it returns no stale publisher can have
# recreated either the cache or a dynamic identity behind it.
export TEST_AEROSPACE_DELAY=0.2
run &
owner=$!
sleep 0.05
run --reset-cache
wait "$owner"
unset TEST_AEROSPACE_DELAY
[ ! -e "$cache_state" ] || fail 'serialized reset retained stale cache'
assert_order 'keyswap'

# Concurrent normal events coalesce: the second records a request and the owner converges once.
: > "$QUERY_LOG"
export TEST_AEROSPACE_DELAY=0.2
run &
owner=$!
sleep 0.05
run
wait "$owner"
unset TEST_AEROSPACE_DELAY
[ "$(wc -l < "$QUERY_LOG" | tr -d ' ')" -ge 4 ] || fail 'coalesced request did not converge in a second pass'

# A contender can lose the old in-lock dirty-file race if it arrives after the
# owner's final check but before teardown. Pause exactly at that boundary, let the
# contender finish, then release the owner. The durable request must cause exactly
# one handoff render (two AeroSpace queries per render).
: > "$QUERY_LOG"
SYNC="$WORK/teardown-sync"
export TEST_FRONTAPPS_LOCK="$RUNTIME/sketchybar_frontapps.lock" TEST_TEARDOWN_SYNC="$SYNC"
run &
owner=$!
wait_for_file "$SYNC.ready"
run &
contender=$!
wait "$contender"
: > "$SYNC.release"
wait "$owner"
unset TEST_FRONTAPPS_LOCK TEST_TEARDOWN_SYNC
[ "$(wc -l < "$QUERY_LOG" | tr -d ' ')" = 4 ] || fail 'teardown-boundary request did not converge exactly once'
[ ! -e "$RUNTIME/sketchybar_frontapps.lock.request" ] || fail 'teardown-boundary request was not consumed'

printf 'frontapps tests: ok\n'
