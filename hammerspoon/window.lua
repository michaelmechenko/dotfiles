-- Window sizing/management driven by Hammerspoon (+ AeroSpace queries).
-- Frames computed directly (no Rectangle) → hold on any display size.
local M = {}
local AEROSPACE = "/opt/homebrew/bin/aerospace"

local function runAerospace(args)
  local output, ok = hs.execute(AEROSPACE .. " " .. args, false)
  if not ok then return "" end
  return output or ""
end

-- True if the AeroSpace server is running and accepting commands. Gates the workspace-wide
-- snap path vs. the display-wide fallback (AeroSpace disabled/paused/uninstalled).
local function aerospaceAvailable()
  local _, ok = hs.execute(AEROSPACE .. " list-windows --all --format '%{window-id}' 2>/dev/null", false)
  return ok == true
end

-- AeroSpace-matched insets in px (mirror the gap states so floating windows line up
-- with tiled ones). Measured from the VISIBLE frame (screen:frame(), below the menu bar) —
-- the same reference AeroSpace insets tiled windows from — so they don't sit too high.
-- The TOP gap is per-monitor, mirroring aerospace.toml `outer.top = [{monitor."Built-*"=N}, M]`
-- (the menu-bar-less external needs a larger top gap than the built-in). Keep in sync with
-- toggle_gaps.sh: big = ALMOST, small = MAXIM.
local ALMOST = { left = 52, right = 52, bottom = 52, top_builtin = 50, top_ext = 74 }  -- big gaps
local MAXIM  = { left = 16, right = 16, bottom = 16, top_builtin = 14, top_ext = 38 }  -- small gaps (biggest window)

local function isBuiltin(scr)
  return ((scr:name() or ""):match("^Built")) ~= nil
end

local function topInset(m, scr)
  return isBuiltin(scr) and m.top_builtin or m.top_ext
end

local function snapInsets(m, win)
  win = win or hs.window.focusedWindow()
  if not win then return end
  local scr = win:screen()
  local s = scr:frame()   -- visible frame (excludes menu bar/dock) — matches AeroSpace's reference
  local top = topInset(m, scr)
  win:setFrame({
    x = s.x + m.left,
    y = s.y + top,
    w = s.w - m.left - m.right,
    h = s.h - top - m.bottom,
  }, 0)
end

function M.almostMaximize() snapInsets(ALMOST) end
function M.maximize() snapInsets(MAXIM) end

-- Snap the focused window to ALMOST insets, but wait for its screen to settle first.
-- Used after cross-monitor moves (cmd-shift-w): the Accessibility API can still report
-- the OLD screen for a few ms after `move-node-to-monitor --focus-follows-window`, so an
-- immediate snapInsets() computes the frame against the wrong monitor and the window lands
-- off-center / on the wrong display. Poll the focused window's screen id; snap as soon as
-- it stabilizes across two ticks (or give up after ~250ms and snap whatever we have).
function M.almostMaximizeAfterMove()
  local win = hs.window.focusedWindow()
  if not win then snapInsets(ALMOST); return end
  local prev = win:screen():id()
  local ticks = 0
  local function step()
    local w = hs.window.focusedWindow()
    if not w then return end
    local cur = w:screen():id()
    ticks = ticks + 1
    if cur == prev or ticks >= 5 then
      snapInsets(ALMOST, w)
      return
    end
    prev = cur
    hs.timer.doAfter(0.05, step)
  end
  hs.timer.doAfter(0.04, step)
end

-- Center the focused window without resizing. Centered horizontally on the screen and
-- vertically within the SAME band as almost-maximize (top=ALMOST.top, bottom=ALMOST.bottom)
-- so its midpoint lines up with the maximize windows (not biased ~11px high).
function M.center()
  local w = hs.window.focusedWindow()
  if not w then return end
  local f = w:frame()
  local scr = w:screen()
  local s = scr:frame()
  local top = topInset(ALMOST, scr)
  w:setFrame({
    x = s.x + (s.w - f.w) / 2,
    y = s.y + top + (s.h - top - ALMOST.bottom - f.h) / 2,
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

-- Fallback for when AeroSpace is disabled/paused: snap every standard visible window on
-- the focused window's display (no AeroSpace IPC, no float step — without the WM windows
-- are already free-floating). If there's no focused window (can't pick a display), fall
-- back to ALL visible standard windows.
local function snapDisplayWindows(m)
  local focused = hs.window.focusedWindow()
  local sid = focused and focused:screen() and focused:screen():id()
  for _, w in ipairs(hs.window.allWindows()) do
    if w:isStandard() and w:isVisible() then
      if not sid or (w:screen() and w:screen():id() == sid) then
        snapInsets(m, w)
      end
    end
  end
end

-- cmd-ctrl-alt-c: workspace-wide when AeroSpace is active (float + snap each window on the
-- focused workspace); display-wide fallback when AeroSpace is disabled/paused.
function M.almostMaximizeFocusedWorkspace()
  if aerospaceAvailable() then
    local ids = focusedWorkspaceWindowIds()
    if #ids > 0 then
      snapByIds(ids, ALMOST)
      return
    end
  end
  snapDisplayWindows(ALMOST)
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
