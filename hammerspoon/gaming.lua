-- gaming.lua
-- Toggle gaming mode: kills borders/sketchybar/aerospace for GPU headroom,
-- or restores them when leaving gaming mode.
-- cmd-ctrl-alt-shift-g: toggle.
local M = {}

local HOME = os.getenv("HOME") or ""
local AEROSPACE = "/opt/homebrew/bin/aerospace"
local SKETCHYBAR = "/opt/homebrew/bin/sketchybar"
local SKETCHYBAR_RC = HOME .. "/.config/sketchybar/sketchybarrc"
local BORDERS = "/opt/homebrew/bin/borders"

-- pgrep works for CLI processes (hs.application.find only finds .app bundles).
local function isRunning(name)
  local out, ok = hs.execute("pgrep -x " .. name .. " 2>/dev/null", false)
  return ok and out ~= nil and out ~= ""
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
    -- Launched via hs.execute + nohup/&, NOT hs.task: an hs.task object is killed by its own
    -- GC finalizer if nothing keeps a Lua reference to it, and an anonymous
    -- hs.task.new(...):start() with no assignment is eligible for GC immediately. A Hammerspoon
    -- config reload forces a GC pass over the old Lua state, which collected these and killed
    -- sketchybar/borders as a side effect. hs.execute's backgrounded subshell isn't tracked by
    -- any Lua object, so nothing can GC-kill it -- same fix as bar.lua's M.reload(). PATH export
    -- is load-bearing: sketchybarrc calls bare `sketchybar` internally and Hammerspoon's GUI env
    -- lacks /opt/homebrew/bin.
    hs.execute(
      "( export PATH=/opt/homebrew/bin:$PATH; nohup " .. SKETCHYBAR .. " -c " .. SKETCHYBAR_RC ..
      " >/dev/null 2>&1 & ) >/dev/null 2>&1 &",
      false
    )
    -- borders is launched via bordersrc (not a hardcoded args list here) so its
    -- style/colors stay in sync with the canonical config -- don't duplicate args.
    hs.execute(
      "( nohup /bin/bash " .. HOME .. "/.config/borders/bordersrc >/dev/null 2>&1 & ) >/dev/null 2>&1 &",
      false
    )
    os.execute(AEROSPACE .. " enable on 2>/dev/null")
    -- bordersrc clears frontapps.sh's tint cache on every cold start, but nothing re-runs
    -- frontapps.sh here -- without this trigger the focused window stays at bordersrc's
    -- static gray until the next real focus/workspace change. Delay so the borders daemon
    -- (started async above) is actually up before frontapps.sh calls `borders apply-to=`.
    hs.timer.doAfter(1, function()
      os.execute("/opt/homebrew/bin/sketchybar --trigger aerospace_focus_change 2>/dev/null")
    end)
    hs.alert.show("normal mode: UI restored")
  end
end

return M
