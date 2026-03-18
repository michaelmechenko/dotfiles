-- window-center.lua
-- Module for centering windows

local VERTICAL_OFFSET = 15

local M = {}

-- Center a single window
-- @param win - window object, or nil for focused window
function M.centerWindow(win)
  win = win or hs.window.focusedWindow()
  if not win then return end

  if win:isFullScreen() then return end

  local frame = win:frame()
  if frame.w > 0 and frame.h > 0 then
    win:centerOnScreen(nil, true, 0)
    frame = win:frame()
    frame.y = frame.y + VERTICAL_OFFSET
    win:setFrame(frame, 0)
  end
end

-- Center all windows from all applications
function M.centerAllWindows()
  local centered = 0
  local skipped = 0

  for _, app in ipairs(hs.application.runningApplications()) do
    local windows = app:allWindows()

    for _, win in ipairs(windows) do
      if win:isFullScreen() then
        skipped = skipped + 1
      else
        local winFrame = win:frame()
        if winFrame.w > 0 and winFrame.h > 0 then
          win:centerOnScreen(nil, true, 0)
          local frame = win:frame()
          frame.y = frame.y + VERTICAL_OFFSET
          win:setFrame(frame, 0)
          centered = centered + 1
        end
      end
    end
  end

  -- hs.alert.show(string.format("Centered %d windows (%d fullscreen skipped)", centered, skipped))
end

return M
