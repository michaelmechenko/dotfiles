-- Lifecycle fixtures for adoption, launch races and independent scratchpads.
local directory = arg[0]:match("^(.*)/") or "."
local function fixture(with_terminal)
  local state = {
    windows = {}, launches = {}, commands = {}, bindings = {}, events = {}, rules = {},
    monitor = { name = "DP-1", width = 2560, height = 1440, scale = 1 },
  }
  local function action(kind, options) return { kind = kind, options = options } end
  hl = {
    get_windows = function() return state.windows end,
    get_active_special_workspace = function() return state.active end,
    window_rule = function(rule) table.insert(state.rules, rule) end,
    on = function(event, callback)
      state.events[event] = state.events[event] or {}
      table.insert(state.events[event], callback)
    end,
    bind = function(key, callback) assert(not state.bindings[key]); state.bindings[key] = callback end,
    exec_cmd = function(command, rules) table.insert(state.launches, { command = command, rules = rules }) end,
    dsp = {
      focus = function(options) return action("focus", options) end,
      workspace = { toggle_special = function(name) return action("toggle", name) end },
      window = {},
    },
    dispatch = function(command)
      table.insert(state.commands, command)
      local kind, options = command.kind, command.options
      if kind == "toggle" then
        local name = "special:" .. options
        if state.active and state.active.name == name then
          state.active, state.focused = nil, nil
        else
          state.active = { name = name }
        end
      elseif kind == "move" then
        assert(options.follow == false)
        options.window.workspace = { name = options.workspace }
        options.window.monitor = state.monitor
      elseif kind == "float" then
        assert(options.action == "enable")
        options.window.floating = true
      elseif kind == "resize" then
        assert(options.window.floating)
        options.window.size = { x = options.x, y = options.y }
      elseif kind == "center" then
        options.window.centered = true
      elseif kind == "focus" then
        state.focused = options.window
      elseif kind == "fullscreen_state" then
        assert(options.action == "set" and options.internal == 0 and options.client == 0)
        options.window.fullscreen_internal, options.window.fullscreen_client = 0, 0
      else error(kind) end
    end,
  }
  for _, kind in ipairs({ "move", "float", "resize", "center", "fullscreen_state" }) do
    hl.dsp.window[kind] = function(options) return action(kind, options) end
  end
  dofile(directory .. "/scratch-sidra.lua")
  assert(#state.rules == 0) -- No global Sidra rule.
  assert(#state.launches == 0 and state.active == nil) -- No eager adoption/launch.
  state.toggle = state.bindings["SUPER + SHIFT + B"]
  assert(state.toggle)
  if with_terminal then dofile(directory .. "/scratch-terminal.lua") end
  state.open = function(window)
    table.insert(state.windows, window)
    for _, callback in ipairs(state.events["window.open"]) do callback(window) end
  end
  return state
end
local function sidra(workspace)
  return { mapped = true, class = "sidra", initial_class = "sidra",
           workspace = { name = workspace or "201" } }
end

local state = fixture()
local window = sidra()
window.fullscreen_internal, window.fullscreen_client = 2, 2
state.windows = { window }
state.toggle()
assert(#state.launches == 0 and state.focused == window)
assert(window.workspace.name == "special:sidra" and window.floating and window.centered)
assert(window.fullscreen_internal == 0 and window.fullscreen_client == 0)
assert(window.size.x == 1792 and window.size.y == 1007) -- floor, including floating-point arithmetic.
local size = window.size
state.toggle()
assert(state.active == nil)
state.toggle()
assert(state.focused == window and window.size == size)
state.monitor = { name = "DP-2", width = 3840, height = 2160, scale = 1.5 }
state.active = nil -- Focus now belongs to another monitor.
state.toggle()
assert(state.active.name == "special:sidra" and window.size == size)

-- Initial adoption on a scaled destination uses its logical dimensions.
state = fixture()
state.monitor = { name = "DP-2", width = 3840, height = 2160, scale = 1.5 }
window = sidra()
state.windows = { window }
state.toggle()
assert(window.monitor == state.monitor and window.size.x == 1792 and window.size.y == 1007)

for presses = 1, 8 do
  state = fixture()
  for _ = 1, presses do state.toggle() end
  assert(#state.launches == 1 and state.launches[1].command == "uwsm app -- sidra")
  assert(state.launches[1].rules.workspace == "special:sidra silent")
  assert(state.launches[1].rules.no_initial_focus)
  window = sidra()
  state.open(window)
  assert(window.floating and window.workspace.name == "special:sidra")
  assert((state.active ~= nil) == (presses % 2 == 1))
  assert(state.focused == (presses % 2 == 1 and window or nil))
  if not state.active then state.toggle() end
  assert(state.focused == window and #state.launches == 1)
end

-- External maps stay ordinary until explicit adoption, even on config reload.
state = fixture()
window = sidra()
state.open(window)
assert(window.workspace.name == "201" and not window.floating and #state.commands == 0)
state.toggle()
assert(window.floating and #state.launches == 0)
-- Already adopted wins over an ordinary extra window.
local extra = sidra()
state.windows = { extra, window }
state.toggle()
state.toggle()
assert(state.focused == window and extra.workspace.name == "201")
-- App-owned close-to-tray/unmapping or full exit permits singleton reinvocation.
window.mapped, extra.mapped, state.active = false, false, nil
state.toggle()
assert(#state.launches == 1)
for _, other in ipairs({ {mapped=true, class="sidra", initial_class="other"},
                         {mapped=true, class="other", initial_class="sidra"} }) do
  state.open(other)
  assert(other.workspace == nil)
end
state.open(sidra())
assert(#state.launches == 1 and state.focused.class == "sidra")

-- Simultaneous pending launches do not share state, commands or identities.
state = fixture(true)
local terminal_toggle = state.bindings["SUPER + SHIFT + F"]
state.toggle()
terminal_toggle()
state.toggle()
terminal_toggle()
assert(#state.launches == 2)
state.open(sidra())
state.open({ mapped=true, class="com.mitchellh.ghostty.scratch" })
assert(#state.launches == 2)
state.toggle()
terminal_toggle()
assert(#state.launches == 2)
print("Sidra Lua: ordinary adoption, logical geometry, rapid toggles, external maps, reuse, recovery and terminal coexistence passed.")
