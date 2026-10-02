-- Ordered numeric IDs drive animations; decorated labels belong to Waybar.
-- Workspaces are monitor-owned; never create them on a missing output.
local function on_monitor(monitor, action)
  return function()
    if hl.get_monitor(monitor) then
      return hl.dispatch(action)
    end
  end
end

for i = 1, 9 do
  local primary = 100 + i
  local secondary = 200 + i
  hl.workspace_rule({ workspace = tostring(primary), monitor = "DP-1", persistent = false, default = i == 1 })
  hl.workspace_rule({ workspace = tostring(secondary), monitor = "DP-2", persistent = false, default = i == 1 })
  hl.bind("SUPER + " .. i, on_monitor("DP-1", hl.dsp.focus({ workspace = primary })))
  hl.bind("SUPER + CTRL + " .. i, on_monitor("DP-2", hl.dsp.focus({ workspace = secondary })))
  hl.bind("SUPER + SHIFT + " .. i, on_monitor("DP-1", hl.dsp.window.move({ workspace = primary, follow = true })))
  hl.bind("SUPER + CTRL + SHIFT + " .. i, on_monitor("DP-2", hl.dsp.window.move({ workspace = secondary, follow = true })))
end

-- Toggle the focused window between outputs, using the destination's active workspace.
hl.bind("SUPER + SHIFT + W", function()
  local window = hl.get_active_window()
  local monitor = window and window.monitor
  if not monitor then return end
  local target
  if monitor.name == "DP-1" then
    target = "DP-2"
  elseif monitor.name == "DP-2" then
    target = "DP-1"
  else
    return
  end
  if hl.get_monitor(target) then
    return hl.dispatch(hl.dsp.window.move({ monitor = target, follow = true }))
  end
end)
