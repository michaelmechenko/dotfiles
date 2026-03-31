require("hs.ipc")
-- local windowCenter = require("window-center")
-- local sendKeys = require("send-keybind")
local rectangle = require("rectangle-keybinds")

_G.rectangleAlmostMaximize = rectangle.almostMaximize
_G.rectangleMaximize = rectangle.maximize
_G.rectangleCenter = rectangle.center
_G.almostMaximizeAll = rectangle.almostMaximizeAll
_G.centerAll = rectangle.centerAll

-- Watch for screen changes
-- screenWatcher = hs.screen.watcher.new(function()
--   hs.timer.doAfter(0.05, rectangle.almostMaximizeAll)
-- end)
--
-- screenWatcher:start()

hs.hotkey.bind({ "cmd", "ctrl", "alt" }, "c", rectangle.almostMaximizeAll)
