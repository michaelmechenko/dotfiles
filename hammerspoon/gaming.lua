-- gaming.lua
-- Toggle gaming mode: kills borders/sketchybar/aerospace for GPU headroom,
-- or restores them when leaving gaming mode.
-- cmd-ctrl-alt-shift-g: toggle.
local M = {}

local HOME = os.getenv("HOME") or ""
local AEROSPACE = "/opt/homebrew/bin/aerospace"
local SKETCHYBAR = "/opt/homebrew/bin/sketchybar"
local BORDERS_RC = HOME .. "/.config/borders/bordersrc"

local function isRunning(name)
  local app = hs.application.find(name)
  return app ~= nil
end

function M.toggleGamingMode()
  local uiActive = isRunning("borders") or isRunning("sketchybar")

  if uiActive then
    -- Enter gaming mode: kill UI helpers, disable aerospace
    os.execute("killall borders 2>/dev/null")
    os.execute("killall sketchybar 2>/dev/null")
    os.execute(AEROSPACE .. " enable off 2>/dev/null")
    hs.alert.show("gaming mode: UI killed")
  else
    -- Exit gaming mode: restart UI helpers, enable aerospace.
    -- Use nohup + disown so os.execute returns immediately (doesn't block IPC).
    os.execute("nohup " .. SKETCHYBAR .. " > /dev/null 2>&1 & disown")
    os.execute("nohup bash " .. BORDERS_RC .. " > /dev/null 2>&1 & disown")
    os.execute(AEROSPACE .. " enable on 2>/dev/null")
    hs.alert.show("normal mode: UI restored")
  end
end

return M
