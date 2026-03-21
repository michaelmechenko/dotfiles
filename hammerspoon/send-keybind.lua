-- send-keybind.lua
-- Module for sending keybinds to windows

local M = {}

-- Send keybind to focused window
function M.sendXToFocusedWindow()
  os.execute(
    [[osascript -e 'tell application "System Events" to keystroke "x" using {control down, option down, command down}']])
end

function M.sendSpaceToFocusedWindow()
  os.execute(
    [[osascript -e 'tell application "System Events" to keystroke "space" using {control down, option down, command down}']])
end

-- Helper: send keybind to all windows sequentially
local function sendToAllWindows(key)
  local windows = {}

  -- Collect all standard visible windows first
  for _, app in ipairs(hs.application.runningApplications()) do
    for _, win in ipairs(app:allWindows()) do
      if win:isStandard() and win:isVisible() then
        table.insert(windows, win)
      end
    end
  end

  -- Process windows sequentially
  local function processWindow(i)
    if i > #windows then return end

    local win = windows[i]
    win:focus()

    hs.timer.doAfter(0.1, function()
      os.execute(string.format(
        [[osascript -e 'tell application "System Events" to keystroke "%s" using {control down, option down, command down}']],
        key
      ))
      -- Move to next window after a short delay
      hs.timer.doAfter(0.02, function()
        processWindow(i + 1)
      end)
    end)
  end

  processWindow(1)
end

function M.sendXToAllWindows()
  sendToAllWindows("x")
end

function M.sendSpaceToAllWindows()
  sendToAllWindows("space")
end

return M
