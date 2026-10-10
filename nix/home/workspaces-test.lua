-- Exercise the same Lua source embedded in the generated Hyprland config.
local directory = arg[0]:match("^(.*)/") or "."
local bindings, rules, dispatched = {}, {}, {}
local connected = { ["DP-1"] = true, ["DP-2"] = true }
local active_window = { monitor = { name = "DP-1" } }
local active_monitor, active_workspace
local special_workspaces = {}
local destinations = {}
local function action(kind, options) return { kind = kind, options = options } end
hl = {
  get_monitor = function(name) return connected[name] end,
  get_active_window = function() return active_window end,
  get_active_monitor = function() return active_monitor end,
  get_active_workspace = function(monitor) assert(monitor == active_monitor); return active_workspace end,
  get_active_special_workspace = function(monitor)
    assert(monitor and monitor.name)
    return special_workspaces[monitor.name]
  end,
  get_workspace = function(id) return destinations[id] end,
  dispatch = function(value) table.insert(dispatched, value) end,
  workspace_rule = function(value) table.insert(rules, value) end,
  bind = function(key, callback, options)
    assert(not bindings[key] and not options); bindings[key] = callback
  end,
  dsp = {
    focus = function(options) return action("focus", options) end,
    window = { move = function(options) return action("move", options) end },
  },
}
dofile(directory .. "/workspaces.lua")
assert(#rules == 18)
local count = 0
for _ in pairs(bindings) do count = count + 1 end
assert(count == 41)
for i = 1, 9 do
  for side = 1, 2 do
    local monitor = "DP-" .. side
    local id = side * 100 + i
    local rule = rules[(i - 1) * 2 + side]
    assert(rule.workspace == tostring(id) and rule.monitor == monitor)
    if i > 1 then
      assert(tonumber(rules[(i - 2) * 2 + side].workspace) < id)
    end
    assert(not rule.persistent and rule.default == (i == 1))
    local modifiers = side == 1 and "SUPER" or "SUPER + CTRL"
    for _, moving in ipairs({false, true}) do
      local key = modifiers .. (moving and " + SHIFT" or "") .. " + " .. i
      bindings[key]()
      local last = dispatched[#dispatched]
      assert(last.kind == (moving and "move" or "focus"))
      assert(type(last.options.workspace) == "number" and last.options.workspace == id)
      if moving then assert(last.options.follow == true) end
      connected[monitor] = nil
      local before = #dispatched
      bindings[key]()
      assert(#dispatched == before)
      connected[monitor] = true
    end
  end
end
for _, source in ipairs({"DP-1", "DP-2"}) do
  local target = source == "DP-1" and "DP-2" or "DP-1"
  active_window = { monitor = { name = source } }
  bindings["SUPER + SHIFT + W"]()
  local last = dispatched[#dispatched]
  assert(last.kind == "move" and last.options.monitor == target and last.options.follow)
  assert(last.options.workspace == nil) -- Resolve the destination's active workspace at dispatch time.
  connected[target] = nil
  local before = #dispatched
  bindings["SUPER + SHIFT + W"]()
  assert(#dispatched == before)
  connected[target] = true
end
for _, window in ipairs({false, {}, {monitor = {}}, {monitor = {name = "HDMI-A-1"}}}) do
  active_window = window or nil
  local before = #dispatched
  bindings["SUPER + SHIFT + W"]()
  assert(#dispatched == before)
end
-- Select in reverse/mixed creation order: dispatch identities must stay ordered.
for _, side in ipairs({1, 2}) do
  local modifiers = side == 1 and "SUPER" or "SUPER + CTRL"
  for _, i in ipairs({9, 1, 7, 2, 8, 3, 6, 4, 5}) do
    bindings[modifiers .. " + " .. i]()
    assert(dispatched[#dispatched].options.workspace == side * 100 + i)
  end
end
-- Adjacent navigation uses numeric identity, not the set/order of occupied workspaces.
local function state(side, index)
  active_monitor = { name = "DP-" .. side }
  active_workspace = { id = side * 100 + index, monitor = active_monitor, special = false }
  active_window = { monitor = active_monitor, workspace = active_workspace }
  special_workspaces = {}
  destinations = {}
end
local function no_action(key)
  local before = #dispatched
  bindings[key]()
  assert(#dispatched == before, key .. " should no-op")
end
for side = 1, 2 do
  for index = 1, 9 do
    for _, delta in ipairs({-1, 1}) do
      for _, moving in ipairs({false, true}) do
        state(side, index)
        local key = moving and (delta == 1 and "SUPER + SHIFT + code:60" or "SUPER + SHIFT + code:59")
          or (delta == 1 and "SUPER + code:48" or "SUPER + code:47")
        if index + delta < 1 or index + delta > 9 then
          no_action(key)
        else
          if not moving then active_window = nil end -- Empty workspace can still navigate.
          special_workspaces["DP-" .. (3 - side)] = { special = true } -- Other output must not block.
          bindings[key]()
          local last = dispatched[#dispatched]
          assert(last.kind == (moving and "move" or "focus"))
          assert(last.options.workspace == side * 100 + index + delta)
          if moving then assert(last.options.window == active_window and last.options.follow == true) end
          -- Existing destination must still belong to this output.
          destinations[last.options.workspace] = { monitor = { name = "DP-" .. (3 - side) } }
          no_action(key)
          destinations[last.options.workspace].monitor = nil
          no_action(key)
          destinations[last.options.workspace].monitor = active_monitor
          bindings[key]()
          assert(dispatched[#dispatched].options.workspace == last.options.workspace)
        end
      end
    end
  end
end
for _, key in ipairs({"SUPER + SHIFT + code:60", "SUPER + SHIFT + code:59", "SUPER + code:47", "SUPER + code:48"}) do
  for _, corrupt in ipairs({
    function() connected["DP-1"] = nil end,
    function() special_workspaces["DP-1"] = { special = true } end,
    function() active_workspace.special = true end,
    function() active_workspace.id = -1 end,
    function() active_workspace.id = "legacy" end,
    function() active_workspace.id = 201 end,
    function() active_workspace.id = 110 end,
    function() active_workspace.id = 100 end,
    function() active_workspace.id = 104.5 end,
    function() active_workspace.monitor = nil end,
    function() active_workspace.monitor = { name = "DP-2" } end,
    function() active_monitor.name = "HDMI-A-1"; connected["HDMI-A-1"] = true end,
  }) do
    state(1, 4)
    corrupt()
    no_action(key)
    connected["DP-1"] = true
    connected["HDMI-A-1"] = nil
  end
  state(1, 4)
  if key:find("SHIFT", 1, true) then
    active_window = nil; no_action(key)
    active_window = {}; no_action(key)
    active_window = { monitor = active_monitor }; no_action(key)
  else
    active_workspace = nil; no_action(key)
    active_monitor = nil; no_action(key)
  end
end
-- Move resolves the window's workspace, not another monitor's active workspace.
state(1, 4)
local origin = active_window
active_monitor = { name = "DP-2" }
active_workspace = { id = 208, monitor = active_monitor }
special_workspaces["DP-2"] = { special = true }
bindings["SUPER + SHIFT + code:60"]()
assert(dispatched[#dispatched].options.workspace == 105 and dispatched[#dispatched].options.window == origin)
print("Workspace Lua: all 41 bindings, ordered IDs, monitor-local stepping, endpoints, moves and guards passed.")
