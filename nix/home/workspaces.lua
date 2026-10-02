-- Named workspaces are monitor-owned; never create them on a missing output.
local function on_monitor(monitor, action)
  return function()
    if hl.get_monitor(monitor) then
      return hl.dispatch(action)
    end
  end
end

for i = 1, 9 do
  local primary = "name:" .. i .. "*"
  local secondary = "name:" .. i .. "^"
  hl.workspace_rule({ workspace = primary, monitor = "DP-1", persistent = true, default = i == 1 })
  hl.workspace_rule({ workspace = secondary, monitor = "DP-2", persistent = true, default = i == 1 })
  hl.bind("SUPER + " .. i, on_monitor("DP-1", hl.dsp.focus({ workspace = primary })))
  hl.bind("SUPER + CTRL + " .. i, on_monitor("DP-2", hl.dsp.focus({ workspace = secondary })))
  hl.bind("SUPER + SHIFT + " .. i, on_monitor("DP-1", hl.dsp.window.move({ workspace = primary, follow = true })))
  hl.bind("SUPER + CTRL + SHIFT + " .. i, on_monitor("DP-2", hl.dsp.window.move({ workspace = secondary, follow = true })))
end

-- Resolve DP-2's active workspace at dispatch time, not a cached workspace ID.
hl.bind("SUPER + SHIFT + W", on_monitor("DP-2", hl.dsp.window.move({ monitor = "DP-2", follow = true })))
