-- SketchyBar full/performance profile toggle, driven from Hammerspoon so the keybind lives
-- with the rest of the cmd-ctrl-alt-* controls. `p` ONLY swaps the active sketchybarrc profile
-- (copy, not symlink) + flips the perf flag — it does NOT reload. `o` does the reload, so the
-- two actions are decoupled (swap config, then apply when ready). In performance mode,
-- aerospace.toml suppresses focus callbacks but retains workspace-change refreshes for muted
-- app/workspace blocks. Reads the new mode from the toggle script's stdout and shows a
-- lowercase hs.alert.
local M = {}

local HOME = os.getenv("HOME") or ""
local SCRIPT = "/bin/bash " .. HOME .. "/.config/sketchybar/toggle_mode.sh"
-- Absolute paths: Hammerspoon is a GUI app and its os.execute/hs.execute env typically lacks
-- /opt/homebrew/bin in PATH, so a bare `sketchybar`/`aerospace` is "command not found" (silent
-- behind 2>/dev/null). Matches the convention in window.lua (which uses /opt/homebrew/bin/
-- aerospace and /opt/homebrew/bin/sketchybar for the same reason).
local SKETCHYBAR = "/opt/homebrew/bin/sketchybar"
local AEROSPACE  = "/opt/homebrew/bin/aerospace"

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

-- cmd-ctrl-alt-o: restart SketchyBar. `--reload` replays the config on the SAME running
-- process, so a wedged daemon (e.g. a stray `drawing=off` from an earlier session, or a hung
-- IPC state) silently survives every reload — the bar stays at raw defaults (height=25,
-- color=0x44000000). A kill + relaunch always recovers it, so this keybind does a full
-- restart, not `--reload`. nohup + `&` so the new daemon isn't tied to Hammerspoon's shell.
-- PATH export is load-bearing: sketchybarrc calls bare `sketchybar` internally, and
-- Hammerspoon's GUI env lacks /opt/homebrew/bin on PATH, so without this the daemon launches
-- but every config command silently fails (command not found) and the bar comes up at raw
-- defaults — same PATH gotcha as window.lua/bordersrc.
function M.reload()
  local RC = HOME .. "/.config/sketchybar/sketchybarrc"
  -- Backgrounded subshell so hs.execute returns immediately (Hammerspoon isn't blocked by the
  -- sleep). A fresh `-c` launch is the ONLY step: do NOT chase it with a `--reload` --- reload
  -- replays the config on the running process, re-adding the right-block items (date/battery/
  -- sep) and stacking them on top of each other. A cold `-c` launch builds them cleanly.
  --  * sleep 1 after pkill: let the killed daemon release its mach service port (a shorter wait
  --    races teardown and the new instance comes up at raw defaults).
  --  * PATH export: sketchybarrc calls bare `sketchybar` internally and HS's GUI env lacks
  --    /opt/homebrew/bin, so without it every config command silently fails -> raw defaults.
  hs.execute(
    "( export PATH=/opt/homebrew/bin:$PATH; /usr/bin/pkill -x sketchybar; sleep 1; " ..
    "nohup " .. SKETCHYBAR .. " -c " .. RC .. " >/dev/null 2>&1 & ) >/dev/null 2>&1 &",
    false
  )
  hs.alert.show("bar: restarted")
end

-- cmd-ctrl-alt-shift-o: toggle the AeroSpace server on/off. AeroSpace's `enable toggle` flips
-- state but doesn't report the result, so probe the CURRENT state first (a list-windows query
-- succeeds iff the server is on) and alert the *new* state. Uses the same aerospaceAvailable
-- detection rationale as window.lua (empty output ≠ disabled server, so check exit status).
function M.toggleAerospace()
  local _, on = hs.execute(AEROSPACE .. " list-windows --all --format '%{window-id}' 2>/dev/null", false)
  hs.execute(AEROSPACE .. " enable " .. (on and "off" or "on"), false)
  hs.alert.show(on and "aerospace: off" or "aerospace: on")
end

return M
