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

-- Step through every numbered workspace, including empty ones, without wrapping.
local function step_workspace(delta, moving)
  return function()
    local window = moving and hl.get_active_window() or nil
    if moving and not window then return end
    local monitor
    if moving then monitor = window.monitor else monitor = hl.get_active_monitor() end
    if not monitor or not hl.get_monitor(monitor.name) then return end
    if hl.get_active_special_workspace(monitor) then return end
    local workspace
    if moving then workspace = window.workspace else workspace = hl.get_active_workspace(monitor) end
    if not workspace or workspace.special or not workspace.monitor
        or workspace.monitor.name ~= monitor.name then return end
    local base = ({ ["DP-1"] = 100, ["DP-2"] = 200 })[monitor.name]
    local id = workspace.id
    if not base or type(id) ~= "number" or id % 1 ~= 0
        or id < base + 1 or id > base + 9 then return end
    local target = id + delta
    if target < base + 1 or target > base + 9 then return end
    -- A reconnected output may leave an existing destination on the wrong monitor.
    local destination = hl.get_workspace(target)
    if destination and (not destination.monitor or destination.monitor.name ~= monitor.name) then return end
    if moving then
      return hl.dispatch(hl.dsp.window.move({ window = window, workspace = target, follow = true }))
    end
    return hl.dispatch(hl.dsp.focus({ workspace = target }))
  end
end

-- Physical US punctuation keys avoid shifted >/< keysym ambiguity (XKB codes).
hl.bind("SUPER + SHIFT + code:60", step_workspace(1, true)) -- period / >
hl.bind("SUPER + SHIFT + code:59", step_workspace(-1, true)) -- comma / <
hl.bind("SUPER + code:47", step_workspace(-1, false)) -- semicolon
hl.bind("SUPER + code:48", step_workspace(1, false)) -- apostrophe

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
