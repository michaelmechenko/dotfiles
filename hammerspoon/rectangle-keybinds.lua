-- Genuine Rectangle Pro actions (rectangle-pro:// URL scheme). Window sizing/float
-- logic now lives in window.lua (pure Hammerspoon, no Rectangle dependency).
local M = {}
local window = require("window")

function M.center()
  os.execute([[open -g "rectangle-pro://execute-action?name=center"]])
end

function M.centerAll()
  window.applyToAllWindows(M.center)
end

return M
