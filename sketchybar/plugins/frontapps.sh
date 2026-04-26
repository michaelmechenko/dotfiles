#!/usr/bin/env bash

set -euo pipefail

ACTIVE_COLOR="0xffEDEDED"
INACTIVE_COLOR="0x80EDEDED"
SEPARATOR="~"
INTER_WORKSPACE_GAP=8

# Focused window id for per-window active highlighting.
FOCUSED_WIN_ID="$(aerospace list-windows --focused --format '%{window-id}' 2>/dev/null || true)"

# Single AeroSpace query for all windows.
WINDOW_DATA="$(aerospace list-windows --all --format '%{workspace}%{tab}%{workspace-is-focused}%{tab}%{window-id}%{tab}%{app-name}' 2>/dev/null || true)"

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
    } | sort -t $'\t' -k1,1n -k2,2n | head -5)"
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

                CMD+=(--set "$app_item" drawing=on "label=$app_name" "label.color=$APP_COLOR" "label.padding_left=0" "label.padding_right=0" "click_script=aerospace focus --window-id $app_id")
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
        [ "$SLOT" -gt 5 ] && break
    done <<< "$SLOTS_DATA"
fi

for ((i = SLOT; i <= 5; i++)); do
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
