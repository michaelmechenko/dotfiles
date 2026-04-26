#!/usr/bin/env bash

set -euo pipefail

# Single AeroSpace query for all windows.
WINDOW_DATA="$(aerospace list-windows --all --format '%{workspace}%{tab}%{workspace-is-focused}%{tab}%{app-name}' 2>/dev/null || true)"

SLOTS_DATA=""
if [ -n "$WINDOW_DATA" ]; then
    # Build per-workspace aggregates in one pass, then sort by:
    # group ('*' before '^' before other), numeric workspace prefix.
    SLOTS_DATA="$({
        printf '%s\n' "$WINDOW_DATA" | awk -F'\t' '
            NF < 3 { next }
            {
                ws = $1
                is_focused = $2
                app = tolower($3)

                count[ws]++
                if (is_focused == "true") focused_ws = ws

                if (app_count[ws] < 6) {
                    if (apps[ws] == "") apps[ws] = app
                    else apps[ws] = apps[ws] " " app
                    app_count[ws]++
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
                    printf "%d\t%d\t%s\t%s\t%d\n", group, num + 0, ws, apps[ws], is_ws_focused
                }
            }
        '
    } | sort -t $'\t' -k1,1n -k2,2n | head -5)"
fi

# Batch all updates into a single SketchyBar call.
CMD=(sketchybar)
SLOT=1

if [ -n "$SLOTS_DATA" ]; then
    while IFS=$'\t' read -r _group _num ws apps is_ws_focused; do
        [ -z "$ws" ] && continue

        if [ "$is_ws_focused" = "1" ]; then
            COLOR="0xffEDEDED"
        else
            COLOR="0x80EDEDED"
        fi

        CMD+=(--set "ws_$SLOT" "label=$ws" "label.color=$COLOR" "label.padding_right=8")
        CMD+=(--set "apps_$SLOT" "label=$apps" "label.color=$COLOR" "label.padding_right=8")

        SLOT=$((SLOT + 1))
        [ "$SLOT" -gt 5 ] && break
    done <<< "$SLOTS_DATA"
fi

for ((i = SLOT; i <= 5; i++)); do
    CMD+=(--set "ws_$i" "label=")
    CMD+=(--set "apps_$i" "label=")
done

"${CMD[@]}"
