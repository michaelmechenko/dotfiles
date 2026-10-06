-- Adopt Sidra's ordinary window on demand; external launches stay ordinary.
local name = "sidra"
local workspace = "special:" .. name
local launching, want_visible = false, false

local function is_sidra(window)
  return window and window.mapped and window.class == "sidra" and window.initial_class == "sidra"
end

local function on_scratch(window)
  return window.workspace and window.workspace.name == workspace
end

local function find_sidra()
  local ordinary
  for _, window in ipairs(hl.get_windows()) do
    if is_sidra(window) then
      if on_scratch(window) then return window end
      ordinary = ordinary or window
    end
  end
  return ordinary
end

local function show()
  local active = hl.get_active_special_workspace()
  if not (active and active.name == workspace) then
    hl.dispatch(hl.dsp.workspace.toggle_special(name))
  end
end

local function adopt(window)
  -- Move before sizing/centering so the geometry uses the destination monitor.
  hl.dispatch(hl.dsp.window.move({ window = window, workspace = workspace, follow = false }))
  hl.dispatch(hl.dsp.window.fullscreen_state({ window = window, internal = 0, client = 0, action = "set" }))
  hl.dispatch(hl.dsp.window.float({ window = window, action = "enable" }))
  local monitor = window.monitor
  if monitor then
    hl.dispatch(hl.dsp.window.resize({
      window = window,
      x = math.floor(monitor.width / monitor.scale * 0.70),
      y = math.floor(monitor.height / monitor.scale * 0.70),
    }))
    hl.dispatch(hl.dsp.window.center({ window = window }))
  end
end

hl.on("window.open", function(window)
  if not launching or not is_sidra(window) then return end
  launching = false
  if want_visible then show() end
  adopt(window)
  if want_visible then hl.dispatch(hl.dsp.focus({ window = window })) end
end)

hl.bind("SUPER + SHIFT + B", function()
  local active = hl.get_active_special_workspace()
  want_visible = not (active and active.name == workspace)
  if not want_visible then
    hl.dispatch(hl.dsp.workspace.toggle_special(name))
    return
  end

  show()
  local window = find_sidra()
  if window then
    if not on_scratch(window) then adopt(window) end
    hl.dispatch(hl.dsp.focus({ window = window }))
  elseif not launching then
    launching = true
    -- Launch-scoped rules avoid a global rule hijacking dock/Fuzzel launches.
    -- Silent placement also prevents a late first map from undoing a hide.
    hl.exec_cmd("uwsm app -- sidra", { workspace = workspace .. " silent", no_initial_focus = true })
  end
end)
