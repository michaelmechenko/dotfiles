-- drag.lua
-- cmd-ctrl + left-click-drag (anywhere in a window's body, not just an edge)
-- moves the window under the cursor. Needed because window-decoration=false
-- (ghostty/config) removes all native titlebar/frame drag handles, but this
-- works for any app, not just Ghostty.
--
-- IMPORTANT: hs.window.frontmostWindow() does a synchronous Accessibility API
-- round-trip to the target app, which pumps the CFRunLoop while waiting for a
-- reply. If that takes long enough (a loaded/slow-to-respond app), the *next*
-- queued mouse event can reach this eventtap callback reentrantly before the
-- mouseDown handler finishes, corrupting `dragging`/`dragWindow` before they're
-- even set. Fix: cache the focused window via a focus-change watcher (which
-- only fires on actual focus changes, not per-click) instead of querying it
-- fresh inside the hot path.
local M = {}

local DRAG_MODIFIERS = { "cmd", "ctrl" }

local cachedWindow = hs.window.frontmostWindow()
local windowFilter = hs.window.filter.new()
windowFilter:subscribe(hs.window.filter.windowFocused, function(win)
	cachedWindow = win
end)

local dragging = false
local dragWindow = nil
local dragOffset = nil

local function modifiersMatch(flags)
	for _, m in ipairs(DRAG_MODIFIERS) do
		if not flags[m] then
			return false
		end
	end
	return true
end

local function handleEvent(event)
	local eventType = event:getType()

	if eventType == hs.eventtap.event.types.leftMouseDown then
		if not modifiersMatch(event:getFlags()) then
			return false
		end

		local win = cachedWindow or hs.window.frontmostWindow()
		if not win then
			return false
		end

		dragging = true
		dragWindow = win
		local winFrame = win:frame()
		-- Use the event's own coordinates, not hs.mouse.absolutePosition() -- the
		-- latter polls the system cursor separately and can race ahead of/behind
		-- the CGEvent the tap actually received, especially for the first event
		-- in a drag sequence.
		local mousePos = event:location()
		dragOffset = { x = mousePos.x - winFrame.x, y = mousePos.y - winFrame.y }
		return true -- swallow the click so it doesn't reach the app underneath
	elseif eventType == hs.eventtap.event.types.leftMouseDragged then
		if not dragging or not dragWindow then
			return false
		end
		local mousePos = event:location()
		dragWindow:setTopLeft({ x = mousePos.x - dragOffset.x, y = mousePos.y - dragOffset.y })
		return true
	elseif eventType == hs.eventtap.event.types.leftMouseUp then
		if dragging then
			dragging = false
			dragWindow = nil
			dragOffset = nil
			return true
		end
		return false
	end
end

local watcher = hs.eventtap.new({
	hs.eventtap.event.types.leftMouseDown,
	hs.eventtap.event.types.leftMouseDragged,
	hs.eventtap.event.types.leftMouseUp,
}, function(event)
	local ok, result = pcall(handleEvent, event)
	if not ok then
		return false
	end
	return result
end)

function M.start()
	watcher:start()
end

function M.stop()
	watcher:stop()
end

M.start()

return M
