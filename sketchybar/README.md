# SketchyBar

`sketchybarrc.full` and `sketchybarrc.performance` are the tracked profile sources.
`sketchybarrc` is the active copied profile; edit the source profiles, not this copy.

## Left block

The full profile keeps only a hidden `frontapps_driver` event subscriber and `keyswap`
static. `plugins/frontapps.sh` creates visible items only for populated workspaces and
windows, with stable workspace/window identities. It caps rendering at seven workspaces
and six windows each. Non-first app items render the `~` separator in their icon, so no
hidden separator slots allocate native windows. Its mode-0700 temporary cache is reset
at full-profile startup and only advances after a successful SketchyBar batch.

## Test

```bash
bash sketchybar/tests/frontapps-test.sh
```

The test runs the real plugin against stubbed AeroSpace and SketchyBar commands. It
covers limits, item ordering/moves/removals, separator geometry, empty and no-op states,
focus/fullscreen/palette changes, failed query/apply recovery, generation reset, and
coalesced concurrent events.

## Deployment and physical verification

After changing a source profile, deliberately refresh the active copy with
`bash sketchybar/toggle_mode.sh --refresh`, then use the existing cold-restart key
(cmd-ctrl-alt-o). Do not use `sketchybar --reload` as a substitute. Updating only the
plugin leaves the old active profile's fixed-slot driver and items running without
the new startup cache reset; do not mix those two generations.

The original and dynamic left blocks were rendered against the same live window
snapshot on SketchyBar 2.24.1. Their captured 700×30 logical-pixel bar regions matched
pixel-for-pixel, including workspace, app and merged-separator spacing. This checks
one populated state, not every focus/fullscreen/display branch.

SketchyBar v2.24.1 resets native display windows on display changes without replaying
the configuration. Physical reconnect/wake timing remains unmeasured; no latency
improvement is claimed.
