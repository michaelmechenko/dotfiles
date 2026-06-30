require("hs.ipc")
local window = require("window")
local bar = require("bar")
-- local rectangle = require("rectangle-keybinds")

-- Globals for `hs -c "..."` callers (aerospace.toml, etc.)
-- _G.rectangleAlmostMaximize = window.almostMaximize
-- _G.rectangleMaximize = window.maximize
-- _G.rectangleCenter = rectangle.center
-- _G.centerAll = rectangle.centerAll
_G.almostMaximize = window.almostMaximize
_G.almostMaximizeAfterMove = window.almostMaximizeAfterMove
_G.center = window.center
_G.center43 = window.center43
_G.almostMaximizeAll = window.almostMaximizeAll
_G.almostMaximizeFocusedWorkspace = window.almostMaximizeFocusedWorkspace
_G.fullMaximize = window.fullMaximize
_G.toggleFloatKeepPos = window.toggleFloatKeepPos
_G.toggleBarMode = bar.toggleMode
_G.toggleAerospace = bar.toggleAerospace

hs.hotkey.bind({ "cmd", "ctrl", "alt" }, "c", window.almostMaximizeFocusedWorkspace)
hs.hotkey.bind({ "cmd", "ctrl", "alt" }, "x", window.almostMaximize)
hs.hotkey.bind({ "cmd", "ctrl", "alt" }, "b", window.center43)
hs.hotkey.bind({ "cmd", "ctrl", "alt" }, "v", window.maximize)
hs.hotkey.bind({ "cmd", "ctrl", "alt", "shift" }, "v", window.fullMaximize)
hs.hotkey.bind({ "cmd", "ctrl", "alt" }, "p", bar.toggleMode)
hs.hotkey.bind({ "cmd", "ctrl", "alt" }, "o", bar.reload)
hs.hotkey.bind({ "cmd", "ctrl", "alt", "shift" }, "o", bar.toggleAerospace)
hs.hotkey.bind({ "cmd", "ctrl", "alt" }, "space", window.center)
