-- Native scratchpad: hiding keeps the terminal alive, closing does not.
local name = "terminal"
local workspace = "special:" .. name
local class = "com.mitchellh.ghostty.scratch"
local launching, want_visible = false, false

hl.window_rule({
  name = "scratch-terminal",
  match = { class = "^com\\.mitchellh\\.ghostty\\.scratch$" },
  float = true,
  size = { "monitor_w * 0.70", "monitor_h * 0.70" },
  center = true,
  -- A late first map must not reopen a scratchpad hidden during startup.
  workspace = workspace .. " silent",
})

local function is_scratch(window)
  return window and window.mapped and window.class == class
end

hl.on("window.open", function(window)
  if not is_scratch(window) then return end
  launching = false
  if want_visible then
    hl.dispatch(hl.dsp.focus({ window = window }))
  end
end)

hl.bind("SUPER + SHIFT + F", function()
  local active = hl.get_active_special_workspace()
  want_visible = not (active and active.name == workspace)
  hl.dispatch(hl.dsp.workspace.toggle_special(name))
  if not want_visible then return end

  for _, window in ipairs(hl.get_windows()) do
    if is_scratch(window) then
      hl.dispatch(hl.dsp.focus({ window = window }))
      return
    end
  end
  -- An empty special workspace disappears when hidden. Its recreation must
  -- not launch again while the original Ghostty is still starting.
  if not launching then
    launching = true
    hl.exec_cmd("uwsm app -- ghostty --class=" .. class .. " --gtk-single-instance=true")
  end
end)
