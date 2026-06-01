-- Window sizing/management driven by Hammerspoon (+ AeroSpace queries).
-- These compute frames directly (no Rectangle), so they hold on any display size.
local M = {}
local AEROSPACE = "/opt/homebrew/bin/aerospace"

local function runAerospace(args)
  local output, ok = hs.execute(AEROSPACE .. " " .. args, false)
  if not ok then return "" end
  return output or ""
end

-- AeroSpace-matched insets in px (mirror the gap states so floating windows line up
-- with tiled ones). Computed against the focused window's screen → display-agnostic.
-- Top includes SketchyBar/menu-bar clearance. Tune here.
local ALMOST = { left = 52, right = 52, top = 74, bottom = 52 }   -- big gaps
local MAXIM  = { left = 16, right = 16, top = 38, bottom = 16 }   -- small gaps

local function snapInsets(m)
  local w = hs.window.focusedWindow()
  if not w then return end
  local s = w:screen():fullFrame()   -- physical edges (aerospace insets from these)
  w:setFrame({
    x = s.x + m.left,
    y = s.y + m.top,
    w = s.w - m.left - m.right,
    h = s.h - m.top - m.bottom,
  }, 0)
end

function M.almostMaximize() snapInsets(ALMOST) end
function M.maximize() snapInsets(MAXIM) end

-- Apply an action to every standard, visible window (focus-cycling). Exposed for reuse.
function M.applyToAllWindows(action)
  local windows = {}
  for _, app in ipairs(hs.application.runningApplications()) do
    for _, win in ipairs(app:allWindows()) do
      if win:isStandard() and win:isVisible() then table.insert(windows, win) end
    end
  end

  local function processWindow(i)
    if i > #windows then return end
    windows[i]:focus()
    hs.timer.doAfter(0.1, function()
      action()
      hs.timer.doAfter(0.05, function() processWindow(i + 1) end)
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
      if original then runAerospace("focus --window-id " .. original) end
      return
    end
    runAerospace("layout floating --window-id " .. ids[i])
    runAerospace("focus --window-id " .. ids[i])
    hs.timer.doAfter(0.1, function()
      action()
      hs.timer.doAfter(0.05, function() processWindow(i + 1) end)
    end)
  end
  processWindow(1)
end

function M.almostMaximizeAll() M.applyToAllWindows(M.almostMaximize) end
function M.almostMaximizeFocusedWorkspace() applyToFocusedWorkspace(M.almostMaximize) end

-- Toggle the focused window tiling<->floating, preserving its on-screen frame when it
-- becomes floating (AeroSpace otherwise repositions it). Going to tiling lets the tree own it.
function M.toggleFloatKeepPos()
  local w = hs.window.focusedWindow()
  local before = w and w:frame()
  runAerospace("layout floating tiling")
  hs.timer.doAfter(0.06, function()
    if w and before then
      local layout = runAerospace("list-windows --focused --format '%{window-layout}'")
      if layout:match("floating") then w:setFrame(before, 0) end
    end
    os.execute([[/opt/homebrew/bin/sketchybar --trigger aerospace_focus_change]])
  end)
end

return M
