#!/usr/bin/env bash

FOCUSED_WS=$(aerospace list-workspaces --focused --format '%{workspace}' 2>/dev/null)

# Get all workspaces with windows.
# Sort by group first ('*' before '^'), then numerically within group (max 5).
WORKSPACES=$(aerospace list-workspaces --all --format '%{workspace}' 2>/dev/null | while read -r ws; do
    COUNT=$(aerospace list-windows --workspace "$ws" --count 2>/dev/null)
    if [ "$COUNT" -gt 0 ]; then
        NUM=$(echo "$ws" | sed -E 's/^([0-9]+).*/\1/')
        SUFFIX=$(echo "$ws" | sed -E 's/^[0-9]+(.*)$/\1/')

        if [ "$SUFFIX" = "*" ]; then
            GROUP=0
        elif [ "$SUFFIX" = "^" ]; then
            GROUP=1
        else
            GROUP=2
        fi

        echo "$GROUP $NUM $ws"
    fi
done | sort -k1,1n -k2,2n | cut -d' ' -f3 | head -5)

# Count how many workspaces we have
WORKSPACE_COUNT=$(echo "$WORKSPACES" | grep -c .)

# Populate slots
SLOT=1
while IFS= read -r ws; do
    [ -z "$ws" ] && continue
    
    # Get apps in this workspace (max 6)
    APPS=$(aerospace list-windows --workspace "$ws" --format '%{app-name}' 2>/dev/null | head -6 | tr '[:upper:]' '[:lower:]' | tr '\n' ' ' | sed 's/ $//')
    
    if [ "$ws" = "$FOCUSED_WS" ]; then
        COLOR="0xffEDEDED"
    else
        COLOR="0x80EDEDED"
    fi
    
    sketchybar --set ws_$SLOT label="$ws" label.color=$COLOR label.padding_right=8
    sketchybar --set apps_$SLOT label="$APPS" label.color=$COLOR label.padding_right=8
    
    SLOT=$((SLOT + 1))
    [ $SLOT -gt 5 ] && break
done <<< "$WORKSPACES"

# Clear unused slots (only those beyond the current count)
for i in $(seq $SLOT 5); do
    sketchybar --set ws_$i label=""
    sketchybar --set apps_$i label=""
done
