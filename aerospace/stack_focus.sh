#!/usr/bin/env bash

# Called from on-focus-changed on every focus change. Cheap no-op unless stack mode
# is active, in which case the newly focused window is fullscreened (idempotent).
[ -f /tmp/aerospace_stack_mode ] || exit 0
aerospace fullscreen on 2>/dev/null || true
