-- display.lua
-- Toggle both external displays between HiDPI and LoDPI for gaming.
-- Primary: Odyssey G50SF. Secondary: XZ322QU V3.
-- Both must be LoDPI when gaming — windowserver composites all displays.
local M = {}

local BETTERDISPLAY = "/Applications/BetterDisplay.app/Contents/MacOS/BetterDisplay"
local DISPLAYS = { "Odyssey G50SF", "XZ322QU V3" }

local function nameLikeArg(name)
  return " -nameLike=" .. string.format("%q", name)
end

function M.toggleDpi()
  local firstOut, ok = hs.execute(BETTERDISPLAY .. " get" .. nameLikeArg(DISPLAYS[1]) .. " -hiDPI", false)
  if not ok or not firstOut then
    hs.alert.show("display: query failed")
    return
  end
  local isOn = firstOut:match("on") ~= nil
  local newState = isOn and "off" or "on"
  for _, name in ipairs(DISPLAYS) do
    hs.execute(BETTERDISPLAY .. " set" .. nameLikeArg(name) .. " -hiDPI=" .. newState, false)
  end
  hs.alert.show(newState == "on" and "displays: HiDPI" or "displays: LoDPI (gaming)")
end

return M
