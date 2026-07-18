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
    -- hs.task launches properly detached processes (os.execute with & gets killed
    -- when the Lua call returns). Pass -c so sketchybar finds its config.
    -- PATH export is load-bearing: sketchybarrc calls bare `sketchybar` internally and
    -- Hammerspoon's GUI env lacks /opt/homebrew/bin, so a direct hs.task launch brings the
    -- bar up at raw defaults (every config command silently fails). Wrap in bash with PATH,
    -- same fix as bar.lua's reload. (bordersrc hardcodes borders' absolute path, so it's fine.)
    hs.task.new("/bin/bash", nil,
      {"-c", "export PATH=/opt/homebrew/bin:$PATH; exec " .. SKETCHYBAR .. " -c " .. SKETCHYBAR_RC}
    ):start()
    -- borders is launched via bordersrc (not a hardcoded args list here) so its
    -- style/colors stay in sync with the canonical config -- don't duplicate args.
    hs.task.new("/bin/bash", nil, {HOME .. "/.config/borders/bordersrc"}):start()
    os.execute(AEROSPACE .. " enable on 2>/dev/null")
    hs.alert.show("normal mode: UI restored")
  end
end

return M
