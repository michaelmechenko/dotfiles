-- SketchyBar full/performance profile toggle, driven from Hammerspoon so the keybind lives
-- with the rest of the cmd-ctrl-alt-* controls. `p` ONLY swaps the active sketchybarrc profile
-- (copy, not symlink) + flips the perf flag — it does NOT reload. `o` does the reload, so the
-- two actions are decoupled (swap config, then apply when ready). AeroSpace callbacks are
-- flag-gated in aerospace.toml so they stay idle in perf mode. Reads the new mode from the
-- toggle script's stdout and shows a lowercase hs.alert.
local M = {}

local HOME = os.getenv("HOME") or ""
local SCRIPT = "/bin/bash " .. HOME .. "/.config/sketchybar/toggle_mode.sh"
-- Absolute path: Hammerspoon is a GUI app and its os.execute/hs.execute env typically lacks
-- /opt/homebrew/bin in PATH, so a bare `sketchybar` is "command not found" (silent behind
-- 2>/dev/null). Matches the convention in window.lua (which uses /opt/homebrew/bin/aerospace
-- and /opt/homebrew/bin/sketchybar for the same reason).
local SKETCHYBAR = "/opt/homebrew/bin/sketchybar"

-- Shrink every hs.alert globally (defaultStyle is a shared module table). Defaults are sized
-- for huge centered overlays (textSize=27, radius=27); these values give a small, tidy pill
-- that matches the bar's visual weight.
hs.alert.defaultStyle.textSize = 14
hs.alert.defaultStyle.radius = 8
hs.alert.defaultStyle.padding = 8
hs.alert.defaultStyle.strokeWidth = 1

-- cmd-ctrl-alt-p: toggle full <-> performance profile.
function M.toggleMode()
  local out = hs.execute(SCRIPT, false)
  local mode = (out or ""):match("performance") and "bar: performance" or "bar: full"
  hs.alert.show(mode)
end

-- cmd-ctrl-alt-o: reload the active SketchyBar config from disk.
function M.reload()
  hs.execute(SKETCHYBAR .. " --reload", false)
  hs.alert.show("bar: reloaded")
end

return M
