-- Structural/lifecycle coverage of the generated config. Real pointer delivery
-- and rendered borders are checked separately by winkeytoggle-input-test.py.
local bindings, events, defining, active = {}, {}, "", ""
local active_border, inactive_border
local function noop() end
local function action(name, value) return { name = name, value = value } end
hl = {
  monitor = noop, curve = noop, animation = noop, workspace_rule = noop, window_rule = noop,
  config = function(options)
    local colors = options.general and options.general.col
    if colors then
      active_border = colors.active_border or active_border
      inactive_border = colors.inactive_border or inactive_border
    end
  end,
  on = function(name, callback) events[name] = callback end,
  get_current_submap = function() return active end,
  dsp = {
    exec_cmd = function(value) return action("exec", value) end,
    submap = function(value) return action("submap", value) end,
    focus = function(value) return action("focus", value) end,
    window = setmetatable({}, { __index = function(_, name)
      return function(value) return action(name, value) end
    end }),
  },
  bind = function(key, dispatcher, options)
    local binding = { key = key, action = dispatcher, options = options or {}, submap = defining, enabled = true }
    function binding:set_enabled(value) self.enabled = value end
    bindings[#bindings + 1] = binding
    return binding
  end,
  define_submap = function(name, callback)
    local previous = defining
    defining = name
    callback()
    defining = previous
  end,
  dispatch = function(dispatcher)
    assert(dispatcher.name == "submap")
    active = dispatcher.value == "reset" and "" or dispatcher.value
    events["keybinds.submap"](active)
  end,
}
local config = assert(arg[1], "Pass the generated hyprland.lua")
assert(loadfile(config))()
local normal_border, normal_inactive = active_border, inactive_border
local toggle = "SUPER + SHIFT + code:49"
local media = {
  XF86AudioRaiseVolume = true, XF86AudioLowerVolume = true, XF86AudioMute = true,
  XF86AudioPlay = true, XF86AudioNext = true, XF86AudioPrev = true,
}
local seen, toggles, mouse = {}, 0, {}
for _, binding in ipairs(bindings) do
  local key, options = binding.key, binding.options
  if key == toggle then
    toggles = toggles + 1
    assert(options.dont_inhibit and not options.repeating and not options.submap_universal)
    assert(binding.action.name == "submap")
    assert(binding.action.value == (binding.submap == "" and "winkeytoggle" or "reset"))
  elseif key:find("SUPER", 1, true) then
    assert(binding.submap == "" and not options.submap_universal)
    if key:find("mouse:", 1, true) then mouse[#mouse + 1] = binding end
  else
    assert(key == "Print" or media[key], "Unaccounted desktop shortcut: " .. key)
    assert(options.submap_universal and binding.submap == "" and binding.action.name == "exec")
    if media[key] then assert(options.locked) end
    if key == "XF86AudioRaiseVolume" or key == "XF86AudioLowerVolume" then assert(options.repeating) end
    assert(not seen[key], "Duplicate shortcut: " .. key)
    seen[key] = true
  end
  assert(binding.submap == "" or (binding.submap == "winkeytoggle" and key == toggle))
end
assert(toggles == 2 and #mouse == 2 and seen.Print)
for key in pairs(media) do assert(seen[key]) end
-- There are no mouse submap assumptions here: the actual handles must disable.
for iteration = 1, 4 do
  local selected
  for _, binding in ipairs(bindings) do
    if binding.key == toggle and binding.submap == active then assert(not selected); selected = binding end
  end
  hl.dispatch(assert(selected).action)
  local released = iteration % 2 == 1
  assert(active == (released and "winkeytoggle" or ""))
  for _, binding in ipairs(mouse) do assert(binding.enabled == not released) end
  assert(active_border == (released and "rgb(d8647e)" or normal_border))
  assert(inactive_border == (released and "rgb(d8647e)" or normal_inactive))
end
-- Full reload re-creates enabled handles and resets either current or legacy mode.
for _, stale in ipairs({ "winkeytoggle", "gaming" }) do
  hl.dispatch(action("submap", stale))
  bindings, events = {}, {}
  assert(loadfile(config))()
  events["config.reloaded"]()
  assert(active == "" and active_border == normal_border and inactive_border == normal_inactive)
  for _, binding in ipairs(bindings) do assert(binding.enabled) end
end
print("winkeytoggle: binding handles, palette transitions, media/Print and reload lifecycle passed.")
