local M = {}
local AEROSPACE = "/opt/homebrew/bin/aerospace"

local function runAerospace(args)
  local output, ok = hs.execute(AEROSPACE .. " " .. args, false)
  if not ok then return "" end
  return output or ""
end

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

local function focusedWorkspaceWindowIds()
  local out = runAerospace("list-windows --workspace focused --format '%{window-id}'")
  local ids = {}

  for line in out:gmatch("[^\r\n]+") do
    local id = tonumber(line)
    if id then table.insert(ids, id) end
  end

  return ids
end

local function focusedWindowId()
  local out = runAerospace("list-windows --focused --format '%{window-id}'")
  return tonumber(out:match("%d+"))
end

local function applyToFocusedWorkspace(action)
  local ids = focusedWorkspaceWindowIds()
  if #ids == 0 then return end

  local original = focusedWindowId()

  local function processWindow(i)
    if i > #ids then
      if original then
        runAerospace("focus --window-id " .. original)
      end
      return
    end

    runAerospace("focus --window-id " .. ids[i])

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

function M.almostMaximizeFocusedWorkspace()
  applyToFocusedWorkspace(M.almostMaximize)
end

function M.centerAll()
  applyToAllWindows(M.center)
end

return M
