require("hs.ipc")
local windowCenter = require("window-center")
local sendKeys = require("send-keybind")

_G.centerWindow = windowCenter.centerWindow
_G.centerAllWindows = windowCenter.centerAllWindows
_G.sendXToAllWindows = sendKeys.sendXToAllWindows
_G.sendSpaceToAllWindows = sendKeys.sendSpaceToAllWindows
_G.sendXToWindow = sendKeys.sendXToFocusedWindow
_G.sendSpaceToWindow = sendKeys.sendSpaceToFocusedWindow

-- Watch for screen changes
screenWatcher = hs.screen.watcher.new(function()
  hs.timer.doAfter(0.1, windowCenter.sendXToAllWindows)
end)

screenWatcher:start()

-- Hotkey: center all windows
hs.hotkey.bind({ "cmd", "ctrl", "alt" }, "c", sendKeys.sendXToAllWindows)

-- Hotkey: center focused window only
-- hs.hotkey.bind({ "cmd", "alt" }, "c", windowCenter.centerWindow)
