require("hs.ipc")
local window = require("window")
-- local rectangle = require("rectangle-keybinds")

-- Globals for `hs -c "..."` callers (aerospace.toml, etc.)
-- _G.rectangleAlmostMaximize = window.almostMaximize
-- _G.rectangleMaximize = window.maximize
-- _G.rectangleCenter = rectangle.center
-- _G.centerAll = rectangle.centerAll
_G.almostMaximize = window.almostMaximize
_G.almostMaximizeAfterMove = window.almostMaximizeAfterMove
_G.center = window.center
_G.almostMaximizeAll = window.almostMaximizeAll
_G.almostMaximizeFocusedWorkspace = window.almostMaximizeFocusedWorkspace
_G.toggleFloatKeepPos = window.toggleFloatKeepPos

hs.hotkey.bind({ "cmd", "ctrl", "alt" }, "c", window.almostMaximizeFocusedWorkspace)
hs.hotkey.bind({ "cmd", "ctrl", "alt" }, "x", window.almostMaximize)
hs.hotkey.bind({ "cmd", "ctrl", "alt" }, "v", window.maximize)
hs.hotkey.bind({ "cmd", "ctrl", "alt" }, "space", window.center)
