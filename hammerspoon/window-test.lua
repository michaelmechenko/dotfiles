-- Run from repository root: lua hammerspoon/window-test.lua
-- Exercise the public toggle; all OS calls are stubbed, never live.
local AEROSPACE = "/opt/homebrew/bin/aerospace "
local originalExecute = os.execute
local cases = 0

local function check(app, rows, companion, resultLayout, noWindow, queryFails)
  local commands, timers, restored, triggers = {}, {}, 0, 0
  local frame = { x = 10, y = 20, w = 800, h = 600 }
  local window = {
    id = function() return 100 end,
    application = function() return app and { name = function() return app end } end,
    frame = function() return frame end,
    setFrame = function(_, value, duration)
      assert(value == frame and duration == 0)
      restored = restored + 1
    end,
  }
  hs = {
    window = { focusedWindow = function() if not noWindow then return window end end },
    timer = { doAfter = function(delay, callback)
      assert(delay == 0.06)
      timers[#timers + 1] = callback
    end },
    execute = function(command, environment)
      assert(environment == false)
      assert(command:sub(1, #AEROSPACE) == AEROSPACE)
      local action = command:sub(#AEROSPACE + 1)
      if action == "list-windows --workspace focused --format '%{window-id}||%{app-name}||%{window-layout}'" then
        if queryFails then return nil, false end
        return rows, true
      elseif action == "list-windows --focused --format '%{window-layout}'" then
        return resultLayout or "floating", true
      end
      commands[#commands + 1] = action
      return "", true
    end,
  }
  os.execute = function(command)
    assert(command == "/opt/homebrew/bin/sketchybar --trigger aerospace_focus_change")
    triggers = triggers + 1
    return true
  end
  local module = dofile("hammerspoon/window.lua")
  module.toggleFloatKeepPos()
  local expected = {}
  if not noWindow then
    if companion then
      expected = { "focus --window-id 100", "layout tiling",
        "focus --window-id " .. companion, "layout tiling", "focus --window-id 100" }
    else
      expected = { "focus --window-id 100", "layout floating tiling" }
    end
  end
  assert(table.concat(commands, ";") == table.concat(expected, ";"),
    tostring(app) .. ": unexpected actions: " .. table.concat(commands, ";"))
  assert(#timers == (noWindow and 0 or 1))
  for _, callback in ipairs(timers) do callback() end
  assert(triggers == (noWindow and 0 or 1))
  assert(restored == ((not noWindow and not companion and (resultLayout or "floating"):match("floating")) and 1 or 0))
  cases = cases + 1
end

local function row(id, app, layout) return id .. "||" .. app .. "||" .. layout .. "\n" end
local own = row(100, "Ghostty", "floating")
-- Preference and tie-break hold under every input permutation.
local candidates = {
  row(5, "Firefox", "floating"), row(30, "LibreWolf", "floating"),
  row(20, "LibreWolf", "floating"), row(1, "Ghostty", "floating"),
}
local function permutations(prefix, remaining)
  if #remaining == 0 then check("Ghostty", own .. prefix, 20); return end
  for i, value in ipairs(remaining) do
    local rest = {}
    for j, other in ipairs(remaining) do if i ~= j then rest[#rest + 1] = other end end
    permutations(prefix .. value, rest)
  end
end
permutations("", candidates)
check("Ghostty", own .. row(4, "Firefox", "floating"), 4)
for _, app in ipairs({ "LibreWolf", "Firefox" }) do
  check(app, row(100, app, "floating") .. row(20, "Ghostty", "floating")
    .. row(10, "Ghostty", "floating") .. row(1, "Firefox", "floating"), 10)
  check(app, row(100, app, "floating") .. row(1, "LibreWolf", "floating"))
end
check("Ghostty", own .. row(1, "Helium", "floating"))
check("Helium", row(100, "Helium", "floating") .. row(1, "Ghostty", "floating"))
check("Obsidian", own)
check(nil, own)
check("Ghostty", own .. row(1, "Ghostty", "floating"))
check("Ghostty", own) -- Other-workspace windows never enter the workspace-scoped response.
check("Ghostty", own .. "malformed\nnot-an-id||LibreWolf||floating\n")
check("Ghostty", own, nil, nil, false, true)
check("Ghostty", row(1, "LibreWolf", "floating")) -- Missing own layout fails closed.
check("Ghostty", own, nil, nil, true)
-- All layout combinations; companion preference is not overridden by floating state.
for _, ownLayout in ipairs({ "floating", "h_tiles" }) do
  for _, otherLayout in ipairs({ "floating", "v_tiles" }) do
    local pair = ownLayout == "floating" and otherLayout == "floating"
    local rows = row(100, "Ghostty", ownLayout) .. row(20, "LibreWolf", otherLayout)
      .. row(1, "Firefox", "floating")
    check("Ghostty", rows, pair and 20 or nil, "floating")
    check("Ghostty", rows, pair and 20 or nil, "h_tiles")
  end
end
os.execute = originalExecute
print(string.format("Passed %d isolated window-toggle cases", cases))
