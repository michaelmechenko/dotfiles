-- Exercise the same Lua source embedded in the generated Hyprland config.
local directory = arg[0]:match("^(.*)/") or "."
local bindings, rules, dispatched = {}, {}, {}
local connected = { ["DP-1"] = true, ["DP-2"] = true }
local active_window = { monitor = { name = "DP-1" } }
local function action(kind, options) return { kind = kind, options = options } end
hl = {
  get_monitor = function(name) return connected[name] end,
  get_active_window = function() return active_window end,
  dispatch = function(value) table.insert(dispatched, value) end,
  workspace_rule = function(value) table.insert(rules, value) end,
  bind = function(key, callback) assert(not bindings[key]); bindings[key] = callback end,
  dsp = {
    focus = function(options) return action("focus", options) end,
    window = { move = function(options) return action("move", options) end },
  },
}
dofile(directory .. "/workspaces.lua")
assert(#rules == 18)
local count = 0
for _ in pairs(bindings) do count = count + 1 end
assert(count == 37)
for i = 1, 9 do
  for side, suffix in ipairs({"*", "^"}) do
    local monitor = "DP-" .. side
    local name = "name:" .. i .. suffix
    local rule = rules[(i - 1) * 2 + side]
    assert(rule.workspace == name and rule.monitor == monitor)
    assert(not rule.persistent and rule.default == (i == 1))
    local modifiers = side == 1 and "SUPER" or "SUPER + CTRL"
    for _, moving in ipairs({false, true}) do
      local key = modifiers .. (moving and " + SHIFT" or "") .. " + " .. i
      bindings[key]()
      local last = dispatched[#dispatched]
      assert(last.kind == (moving and "move" or "focus"))
      assert(last.options.workspace == name)
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
print("Workspace Lua: nonpersistent rules, defaults, all 37 bindings, bidirectional moves and guards passed.")
