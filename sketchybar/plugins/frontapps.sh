#!/usr/bin/env bash

FOCUSED_WS=$(aerospace list-workspaces --focused --format '%{workspace}' 2>/dev/null)

# Get all workspaces with windows, sorted numerically (max 5)
WORKSPACES=$(aerospace list-workspaces --all --format '%{workspace}' 2>/dev/null | while read -r ws; do
    COUNT=$(aerospace list-windows --workspace "$ws" --count 2>/dev/null)
    if [ "$COUNT" -gt 0 ]; then
        NUM=$(echo "$ws" | sed 's/[^0-9]//g')
        echo "$NUM $ws"
    fi
done | sort -n | cut -d' ' -f2 | head -5)

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
