-- Pure lifecycle fixtures; never contact the running compositor.
local directory = arg[0]:match("^(.*)/") or "."
local class = "com.mitchellh.ghostty.scratch"
local function fixture()
  local state = { windows = {}, launches = {}, focused = nil, active = nil }
  local rules, events, bindings = {}, {}, {}
  hl = {
    window_rule = function(rule) table.insert(rules, rule) end,
    on = function(event, callback) events[event] = callback end,
    bind = function(key, callback) assert(not bindings[key]); bindings[key] = callback end,
    get_active_special_workspace = function() return state.active end,
    get_windows = function() return state.windows end,
    exec_cmd = function(command) table.insert(state.launches, command) end,
    dsp = {
      workspace = { toggle_special = function(name) return { toggle = name } end },
      focus = function(options) return { focus = options.window } end,
    },
    dispatch = function(action)
      if action.toggle then
        assert(action.toggle == "terminal")
        if state.active and state.active.name == "special:terminal" then
          state.active, state.focused = nil, nil
        else
          state.active = { name = "special:terminal" }
        end
      else
        assert(action.focus)
        state.focused = action.focus
      end
    end,
  }
  dofile(directory .. "/scratch-terminal.lua")
  assert(#rules == 1)
  local rule = rules[1]
  assert(rule.match.class == "^com\\.mitchellh\\.ghostty\\.scratch$")
  assert(rule.float and rule.center)
  assert(rule.size[1] == "monitor_w * 0.70" and rule.size[2] == "monitor_h * 0.70")
  assert(rule.workspace == "special:terminal silent")
  assert(#state.launches == 0 and state.active == nil) -- No eager launch.
  local count = 0
  for _ in pairs(bindings) do count = count + 1 end
  assert(count == 1)
  state.toggle = bindings["SUPER + SHIFT + F"]
  assert(state.toggle)
  state.open = function(window)
    table.insert(state.windows, window)
    events["window.open"](window)
  end
  return state
end

-- Any number of toggles before mapping: one launch, latest visibility wins.
for presses = 1, 8 do
  local state = fixture()
  for _ = 1, presses do state.toggle() end
  assert(#state.launches == 1)
  assert(state.launches[1] == "uwsm app -- ghostty --class=" .. class .. " --gtk-single-instance=true")
  local window = { class = class, mapped = true }
  state.open(window)
  assert((state.active ~= nil) == (presses % 2 == 1))
  assert(state.focused == (presses % 2 == 1 and window or nil))
  if not state.active then state.toggle() end
  assert(state.focused == window and #state.launches == 1)
  state.toggle()
  assert(state.active == nil)
  state.toggle()
  assert(state.focused == window and #state.launches == 1)
end

local state = fixture()
state.toggle()
state.open({ class = "com.mitchellh.ghostty", mapped = true })
assert(state.focused == nil) -- Ordinary Ghostty does not settle scratch launch.
state.toggle()
state.toggle()
assert(#state.launches == 1)
local scratch = { class = class, mapped = true }
state.open(scratch)
assert(state.focused == scratch)
-- On another monitor, active-special query is local: show, not hide.
state.active = nil
state.toggle()
assert(state.active and state.focused == scratch and #state.launches == 1)
-- Close/crash after map: native cleanup leaves no mapped scratch or overlay.
scratch.mapped = false
state.active = nil
state.toggle()
assert(#state.launches == 2)
-- Config reload can discover an already mapped scratch without launching.
state = fixture()
state.windows = { { class = class, mapped = true } }
state.toggle()
assert(state.focused == state.windows[1] and #state.launches == 0)
print("Scratch terminal Lua: rules, lazy launch, rapid toggles, delayed mapping, reuse, monitor transfer and close recovery passed.")
