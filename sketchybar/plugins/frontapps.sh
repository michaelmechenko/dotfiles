#!/usr/bin/env bash

set -euo pipefail

ACTIVE_COLOR="0xffEDEDED"
INACTIVE_COLOR="0x80EDEDED"
SEPARATOR="~"
INTER_WORKSPACE_GAP=8

# Leading-edge coalescing. A workspace switch fires both aerospace_workspace_change
# and aerospace_focus_change, which SketchyBar runs concurrently — without this the
# IPC-heavy rebuild below runs twice and races. Run the first event immediately; fold
# any event that arrives mid-rebuild into a single extra pass. macOS has no flock(1),
# so mkdir is the atomic lock; the pid + kill -0 guard clears a stale lock if a run
# was killed (incl. SketchyBar's FORK_TIMEOUT).
LOCK="${TMPDIR:-/tmp}/sketchybar_frontapps.lock"
DIRTY="$LOCK/dirty"
if ! mkdir "$LOCK" 2>/dev/null; then
  if [ -f "$LOCK/pid" ] && ! kill -0 "$(cat "$LOCK/pid" 2>/dev/null)" 2>/dev/null; then
    rm -rf "$LOCK"
    mkdir "$LOCK" 2>/dev/null || { : >"$DIRTY" 2>/dev/null; exit 0; }
  else
    : > "$DIRTY" 2>/dev/null
    exit 0
  fi
fi
echo $$ > "$LOCK/pid"

_TMPDIR="$(mktemp -d)"
trap 'rm -rf "$_TMPDIR" "$LOCK"' EXIT

while :; do
rm -f "$DIRTY"

# Run both aerospace queries in parallel — one IPC roundtrip instead of two.
aerospace list-windows --focused --format '%{window-id}' >"$_TMPDIR/focused" 2>/dev/null &
aerospace list-windows --all --format '%{workspace}%{tab}%{workspace-is-focused}%{tab}%{window-id}%{tab}%{app-name}%{tab}%{window-is-fullscreen}%{tab}%{window-layout}' >"$_TMPDIR/all" 2>/dev/null &
wait
FOCUSED_WIN_ID="$(cat "$_TMPDIR/focused" 2>/dev/null || true)"
WINDOW_DATA="$(cat "$_TMPDIR/all" 2>/dev/null || true)"

# Fullscreen-window lookup (field 5 == "true"); drives both brackets and border tinting.
# Space-padded id set + `case` membership test instead of `declare -A` (associative arrays are
# bash 4+; macOS ships bash 3.2, so this keeps the plugin portable without `brew install bash`).
FS_IDS=" $(printf '%s\n' "$WINDOW_DATA" | awk -F'\t' '$5=="true"{print $3}' | tr '\n' ' ')"

SLOTS_DATA=""
if [ -n "$WINDOW_DATA" ]; then
    # Build per-workspace aggregates in one pass, then sort by group
    # ('*' before '^' before other), numeric workspace prefix.
    # Output fields:
    # group, num, ws, is_ws_focused,
    # [app1_id, app1_name, ..., app6_id, app6_name]
    SLOTS_DATA="$({
        printf '%s\n' "$WINDOW_DATA" | awk -F'\t' '
            NF < 4 { next }
            {
                ws = $1
                is_focused = $2
                win_id = $3
                app = tolower($4)

                count[ws]++
                if (is_focused == "true") focused_ws = ws

                if (app_count[ws] < 6) {
                    app_count[ws]++
                    idx = app_count[ws]
                    app_id[ws, idx] = win_id
                    app_name[ws, idx] = app
                }
            }
            END {
                for (ws in count) {
                    num = ws
                    sub(/[^0-9].*$/, "", num)

                    suffix = ws
                    sub(/^[0-9]+/, "", suffix)

                    group = 2
                    if (suffix == "*") group = 0
                    else if (suffix == "^") group = 1

                    is_ws_focused = (ws == focused_ws ? 1 : 0)

                    printf "%d\t%d\t%s\t%d", group, num + 0, ws, is_ws_focused
                    for (i = 1; i <= 6; i++) {
                        printf "\t%s\t%s", app_id[ws, i], app_name[ws, i]
                    }
                    printf "\n"
                }
            }
        '
    } | sort -t $'\t' -k1,1n -k2,2n | head -7)"
fi

# Batch all updates into a single SketchyBar call.
CMD=(sketchybar)
SLOT=1

if [ -n "$SLOTS_DATA" ]; then
    while IFS=$'\t' read -r _group _num ws is_ws_focused \
        app1_id app1_name app2_id app2_name app3_id app3_name \
        app4_id app4_name app5_id app5_name app6_id app6_name; do
        [ -z "$ws" ] && continue

        if [ "$is_ws_focused" = "1" ]; then
            WS_COLOR="$ACTIVE_COLOR"
        else
            WS_COLOR="$INACTIVE_COLOR"
        fi

        if [ "$SLOT" -gt 1 ]; then
            WS_LEFT_PAD="$INTER_WORKSPACE_GAP"
        else
            WS_LEFT_PAD=0
        fi

        CMD+=(--set "ws_$SLOT" drawing=on "label=$ws" "label.color=$WS_COLOR" "label.padding_left=$WS_LEFT_PAD" "label.padding_right=8")

        APP_IDS=("$app1_id" "$app2_id" "$app3_id" "$app4_id" "$app5_id" "$app6_id")
        APP_NAMES=("$app1_name" "$app2_name" "$app3_name" "$app4_name" "$app5_name" "$app6_name")

        for ((j = 1; j <= 6; j++)); do
            idx=$((j - 1))
            app_item="app_${SLOT}_${j}"
            app_id="${APP_IDS[$idx]}"
            app_name="${APP_NAMES[$idx]}"

            if [ -n "$app_name" ]; then
                APP_COLOR="$INACTIVE_COLOR"
                if [ -n "$FOCUSED_WIN_ID" ] && [ "$app_id" = "$FOCUSED_WIN_ID" ]; then
                    APP_COLOR="$ACTIVE_COLOR"
                fi

                # Bracket the label when the window is (aerospace) fullscreen.
                # Bracketed labels need a little right padding so the trailing ']' isn't clipped.
                app_label="$app_name"; APP_RPAD=0
                case "$FS_IDS" in *" $app_id "*) app_label="[$app_name]"; APP_RPAD=4 ;; esac

                CMD+=(--set "$app_item" drawing=on "label=$app_label" "label.color=$APP_COLOR" "label.padding_left=0" "label.padding_right=$APP_RPAD" "click_script=aerospace focus --window-id $app_id")
            else
                CMD+=(--set "$app_item" drawing=off "label=" "click_script=")
            fi
        done

        for ((j = 1; j <= 5; j++)); do
            cur_app="${APP_NAMES[$((j - 1))]}"
            next_app="${APP_NAMES[$j]}"
            sep_item="sep_${SLOT}_${j}"

            if [ -n "$cur_app" ] && [ -n "$next_app" ]; then
                CMD+=(--set "$sep_item" drawing=on "label=$SEPARATOR" "label.color=$INACTIVE_COLOR" "label.padding_left=4" "label.padding_right=4")
            else
                CMD+=(--set "$sep_item" drawing=off "label=")
            fi
        done

        SLOT=$((SLOT + 1))
        [ "$SLOT" -gt 7 ] && break
    done <<< "$SLOTS_DATA"
fi

for ((i = SLOT; i <= 7; i++)); do
    if [ "$i" -eq 1 ]; then
        # Keep ws_1 active as the event subscriber/driver item.
        CMD+=(--set "ws_1" drawing=on "label=" "label.padding_left=0" "label.padding_right=0")
    else
        CMD+=(--set "ws_$i" drawing=off "label=")
    fi

    for ((j = 1; j <= 6; j++)); do
        CMD+=(--set "app_${i}_${j}" drawing=off "label=" "click_script=")
    done

    for ((j = 1; j <= 5; j++)); do
        CMD+=(--set "sep_${i}_${j}" drawing=off "label=")
    done
done

"${CMD[@]}"

# Per-window border color by state (focused window only; unfocused dims to inactive):
#   fullscreen → rose #d8647e, floating → lavender #aeaed1, tiling/"sticky" → dusty #bb9dbd.
# JankyBorders apply-to is write-only, so diff "id color" against saved state; only changed
# windows get a borders call. inactive_color stays dark so unfocused windows still dim.
BORDERS=/opt/homebrew/bin/borders
INACT=0xff1c1c24
CUR_COLORS="$(printf '%s\n' "$WINDOW_DATA" | awk -F'\t' '
  NF>=6 && $3!="" {
    c="0xffbb9dbd"                                  # tiling / sticky, non-maximized
    if ($5=="true") c="0xffd8647e"                  # maximized (aerospace fullscreen)
    else if ($6=="floating") c="0xffaeaed1"         # floating
    print $3" "c
  }' | sort)"
PREV_COLORS="$(sort /tmp/aerospace_border_colors 2>/dev/null || true)"
{ set +e
  comm -23 <(printf '%s\n' "$CUR_COLORS") <(printf '%s\n' "$PREV_COLORS") | while read -r id c; do
    [ -n "$id" ] && "$BORDERS" apply-to=$id active_color=$c inactive_color=$INACT >/dev/null 2>&1
  done
  set -e; }
printf '%s\n' "$CUR_COLORS" > /tmp/aerospace_border_colors

# An event arrived while rebuilding → run one more pass to capture final state.
[ -e "$DIRTY" ] || break
done
