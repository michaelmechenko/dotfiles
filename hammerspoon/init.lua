require("hs.ipc")
local windowCenter = require("window-center")

_G.centerWindow = windowCenter.centerWindow
_G.centerAllWindows = windowCenter.centerAllWindows

-- Watch for screen changes
screenWatcher = hs.screen.watcher.new(function()
  hs.timer.doAfter(0.2, windowCenter.centerAllWindows)
end)
screenWatcher:start()

-- Hotkey: center all windows
hs.hotkey.bind({ "cmd", "ctrl", "alt" }, "c", windowCenter.centerAllWindows)

-- Hotkey: center focused window only
-- hs.hotkey.bind({ "cmd", "alt" }, "c", windowCenter.centerWindow)
