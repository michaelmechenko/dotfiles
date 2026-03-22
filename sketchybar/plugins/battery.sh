#!/usr/bin/env bash
BATTERY=$(pmset -g batt | grep -oE '\d+%' | head -1 | tr '[:upper:]' '[:lower:]')
sketchybar --set "$NAME" label="$BATTERY"
