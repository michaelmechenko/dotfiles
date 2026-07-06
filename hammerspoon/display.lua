-- display.lua
-- Toggle the main 5K display between HiDPI (5K framebuffer, UI 2560x1440)
-- and LoDPI (native 2560x1440) for gaming. LoDPI cuts windowserver
-- compositing from ~14.7M to ~3.7M pixels/frame (4x less GPU overhead).
-- Uses BetterDisplay CLI (enabled by default in BD v4.4.0+).
local M = {}

-- Absolute path: Hammerspoon is a GUI app and its hs.execute env typically lacks
-- PATH, so a bare `BetterDisplay` is "command not found". Matches the convention
-- in bar.lua (which uses /opt/homebrew/bin/sketchybar for the same reason).
local BETTERDISPLAY = "/Applications/BetterDisplay.app/Contents/MacOS/BetterDisplay"
local DISPLAY_NAME = "XZ322QU"

-- cmd-ctrl-alt-l: toggle HiDPI on the main gaming display.
-- Probes current state first (matching bar.lua's toggleAerospace pattern)
-- so we can report the NEW state accurately.
function M.toggleDpi()
  local out, ok = hs.execute(BETTERDISPLAY .. " get -nameLike=" .. DISPLAY_NAME .. " -hiDPI", false)
  if not ok or not out then
    hs.alert.show("display: query failed")
    return
  end
  local isOn = out:match("on") ~= nil
  local newState = isOn and "off" or "on"
  hs.execute(BETTERDISPLAY .. " set -nameLike=" .. DISPLAY_NAME .. " -hiDPI=" .. newState, false)
  hs.alert.show(newState == "on" and "display: HiDPI" or "display: LoDPI (gaming)")
end

return M
