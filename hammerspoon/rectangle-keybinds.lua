local M = {}

function M.almostMaximize()
  os.execute([[open -g "rectangle-pro://execute-action?name=almost-maximize"]])
end

function M.maximize()
  os.execute([[open -g "rectangle-pro://execute-action?name=maximize"]])
end

function M.center()
  os.execute([[open -g "rectangle-pro://execute-action?name=center"]])
end

local function applyToAllWindows(action)
  local windows = {}

  for _, app in ipairs(hs.application.runningApplications()) do
    for _, win in ipairs(app:allWindows()) do
      if win:isStandard() and win:isVisible() then
        table.insert(windows, win)
      end
    end
  end

  local function processWindow(i)
    if i > #windows then return end

    local win = windows[i]
    win:focus()

    hs.timer.doAfter(0.1, function()
      action()
      hs.timer.doAfter(0.05, function()
        processWindow(i + 1)
      end)
    end)
  end
  processWindow(1)
end

function M.almostMaximizeAll()
  applyToAllWindows(M.almostMaximize)
end

function M.centerAll()
  applyToAllWindows(M.center)
end

return M
