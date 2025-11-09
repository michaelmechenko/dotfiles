#!/usr/bin/env bash

WORKSPACE_ID="${NAME#space.}"

if [ "$WORKSPACE_ID" = "$FOCUSED_WORKSPACE" ]; then
    sketchybar --set "$NAME" icon.color=0xffEDEDED background.drawing=off
else
    sketchybar --set "$NAME" icon.color=0x85EDEDED background.drawing=off
fi
