-- display.lua
-- Toggle all displays between HiDPI and LoDPI for gaming.
-- Primary (XZ322QU): 5K HiDPI -> 2560x1440 LoDPI (4x less compositing).
-- Secondary (DELL P2419H): 4K HiDPI -> 1920x1080 LoDPI (4x less compositing).
-- Both must be LoDPI when gaming — windowserver composites all displays.
local M = {}

local BETTERDISPLAY = "/Applications/BetterDisplay.app/Contents/MacOS/BetterDisplay"
local DISPLAYS = { "XZ322QU", "P2419H" }

function M.toggleDpi()
  local firstOut, ok = hs.execute(BETTERDISPLAY .. " get -nameLike=" .. DISPLAYS[1] .. " -hiDPI", false)
  if not ok or not firstOut then
    hs.alert.show("display: query failed")
    return
  end
  local isOn = firstOut:match("on") ~= nil
  local newState = isOn and "off" or "on"
  for _, name in ipairs(DISPLAYS) do
    hs.execute(BETTERDISPLAY .. " set -nameLike=" .. name .. " -hiDPI=" .. newState, false)
  end
  hs.alert.show(newState == "on" and "displays: HiDPI" or "displays: LoDPI (gaming)")
end

return M
