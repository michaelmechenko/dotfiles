#!/usr/bin/env bash

WORKSPACE=$(aerospace list-workspaces --focused --format '%{workspace}' 2>/dev/null)
WINDOWS=$(aerospace list-windows --workspace focused --format '%{window-id} %{app-name}')
FOCUSED_WID=$(aerospace list-windows --focused --format '%{window-id}' 2>/dev/null)

LABEL=""
FIRST=true
while IFS= read -r line; do
    [ -z "$line" ] && continue
    WID=$(echo "$line" | awk '{print $1}')
    APP=$(echo "$line" | awk '{$1=""; print $0}' | sed 's/^ //' | tr '[:upper:]' '[:lower:]')
    
    if [ "$WID" = "$FOCUSED_WID" ]; then
        APP_DISPLAY="[$APP]"
    else
        APP_DISPLAY="$APP"
    fi
    
    if [ "$FIRST" = true ]; then
        LABEL="$APP_DISPLAY"
        FIRST=false
    else
        LABEL="$LABEL * $APP_DISPLAY"
    fi
done <<< "$WINDOWS"

sketchybar --set frontapps_ws label="$WORKSPACE"
sketchybar --set frontapps_apps label="$LABEL"
