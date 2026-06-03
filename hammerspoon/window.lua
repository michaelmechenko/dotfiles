-- Window sizing/management driven by Hammerspoon (+ AeroSpace queries).
-- Frames computed directly (no Rectangle) → hold on any display size.
local M = {}
local AEROSPACE = "/opt/homebrew/bin/aerospace"

local function runAerospace(args)
  local output, ok = hs.execute(AEROSPACE .. " " .. args, false)
  if not ok then return "" end
  return output or ""
end

-- AeroSpace-matched insets in px (mirror the gap states so floating windows line up
-- with tiled ones). Top includes SketchyBar/menu-bar clearance. Tune here.
local ALMOST = { left = 52, right = 52, top = 74, bottom = 52 }   -- big gaps
local MAXIM  = { left = 16, right = 16, top = 38, bottom = 16 }   -- small gaps

local function snapInsets(m, win)
  win = win or hs.window.focusedWindow()
  if not win then return end
  local s = win:screen():fullFrame()   -- physical edges (aerospace insets from these)
  win:setFrame({
    x = s.x + m.left,
    y = s.y + m.top,
    w = s.w - m.left - m.right,
    h = s.h - m.top - m.bottom,
  }, 0)
end

function M.almostMaximize() snapInsets(ALMOST) end
function M.maximize() snapInsets(MAXIM) end

-- Center the focused window without resizing. Centered horizontally on the screen and
-- vertically within the SAME band as almost-maximize (top=ALMOST.top, bottom=ALMOST.bottom)
-- so its midpoint lines up with the maximize windows (not biased ~11px high).
function M.center()
  local w = hs.window.focusedWindow()
  if not w then return end
  local f = w:frame()
  local s = w:screen():fullFrame()
  w:setFrame({
    x = s.x + (s.w - f.w) / 2,
    y = s.y + ALMOST.top + (s.h - ALMOST.top - ALMOST.bottom - f.h) / 2,
    w = f.w,
    h = f.h,
  }, 0)
end

-- Float each window (by id, no focus change) then setFrame it to the inset rect.
-- No focus-cycling / no sleeps → near-instant, no flicker, focus stays put.
local function snapByIds(ids, m)
  if #ids == 0 then return end
  local byId = {}
  for _, w in ipairs(hs.window.allWindows()) do byId[w:id()] = w end
  for _, id in ipairs(ids) do
    runAerospace("layout floating --window-id " .. id)
    local w = byId[id]
    if w then snapInsets(m, w) end
  end
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

function M.almostMaximizeFocusedWorkspace()
  snapByIds(focusedWorkspaceWindowIds(), ALMOST)
end

function M.almostMaximizeAll()
  local ids = {}
  for _, w in ipairs(hs.window.allWindows()) do
    if w:isStandard() and w:isVisible() then ids[#ids + 1] = w:id() end
  end
  snapByIds(ids, ALMOST)
end

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
