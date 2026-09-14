-- Keep AeroSpace focus local when macOS chooses an old window after a close.
-- Cmd-W is routed through closeWindow(). Cmd-Q remains native: the key event is
-- observed but never consumed, and focus is repaired only after the app exits.
local M = {}

local AEROSPACE = "/opt/homebrew/bin/aerospace"
local RESTORE_DELAY = 0.15
local CLOSE_RECHECK_DELAY = 0.15
local QUIT_TTL = 3
local HISTORY_LIMIT = 8
local SUBSCRIBE_RETRY_DELAY = 2
local SUBSCRIBE_RETRY_LIMIT = 3

local log = hs.logger.new("close_focus", "warning")
local activeTasks = {}
local nextTaskID = 0
local subscriber = nil
local subscriberBuffer = ""
local subscriberRetries = 0
local subscriberRetryTimer = nil
local currentWorkspace = nil
local currentWindowID = nil
local focusHistory = {}
local pendingQuits = {}
local generation = 0
local keyWatcher = nil
local appWatcher = nil

local function now()
  return hs.timer.absoluteTime() / 1000000000
end

local function runAerospace(arguments, callback)
  nextTaskID = nextTaskID + 1
  local taskID = nextTaskID
  local task

  task = hs.task.new(AEROSPACE, function(exitCode, stdout, stderr)
    activeTasks[taskID] = nil
    if callback then
      callback(exitCode, stdout or "", stderr or "")
    end
  end, arguments)

  if not task then
    return false
  end

  activeTasks[taskID] = task
  if not task:start() then
    activeTasks[taskID] = nil
    return false
  end
  return true
end

local function rememberFocus(workspace, windowID)
  if type(workspace) ~= "string" or workspace == "" then
    return
  end

  currentWorkspace = workspace
  currentWindowID = tonumber(windowID)
  if not currentWindowID then
    return
  end

  local history = focusHistory[workspace] or {}
  for index = #history, 1, -1 do
    if history[index] == currentWindowID then
      table.remove(history, index)
    end
  end
  table.insert(history, 1, currentWindowID)
  while #history > HISTORY_LIMIT do
    table.remove(history)
  end
  focusHistory[workspace] = history
end

local function consumeSubscriberOutput(output)
  subscriberBuffer = subscriberBuffer .. (output or "")
  while true do
    local newline = subscriberBuffer:find("\n", 1, true)
    if not newline then
      return
    end

    local line = subscriberBuffer:sub(1, newline - 1)
    subscriberBuffer = subscriberBuffer:sub(newline + 1)
    if line ~= "" then
      local ok, event = pcall(hs.json.decode, line)
      if ok and type(event) == "table" and event._event == "focus-changed" then
        subscriberRetries = 0
        rememberFocus(event.workspace, event.windowId)
      end
    end
  end
end

local startSubscriber

local function scheduleSubscriberRetry()
  if subscriberRetries >= SUBSCRIBE_RETRY_LIMIT or subscriberRetryTimer then
    return
  end

  subscriberRetries = subscriberRetries + 1
  subscriberRetryTimer = hs.timer.doAfter(SUBSCRIBE_RETRY_DELAY, function()
    subscriberRetryTimer = nil
    startSubscriber()
  end)
end

startSubscriber = function()
  if subscriber and subscriber:isRunning() then
    return
  end

  subscriberBuffer = ""
  local task
  task = hs.task.new(
    AEROSPACE,
    function(exitCode, _, stderr)
      if subscriber == task then
        subscriber = nil
        currentWorkspace = nil
        currentWindowID = nil
      end
      if exitCode ~= 0 and stderr and stderr ~= "" then
        log.wf("AeroSpace focus subscription exited: %s", stderr:gsub("%s+$", ""))
      end
      scheduleSubscriberRetry()
    end,
    function(streamTask, stdout, _)
      if streamTask then
        consumeSubscriberOutput(stdout)
      end
      return true
    end,
    { "subscribe", "focus-changed" }
  )

  if not task then
    scheduleSubscriberRetry()
    return
  end

  subscriber = task
  if not task:start() then
    subscriber = nil
    scheduleSubscriberRetry()
  end
end

local function captureContext(kind, pid)
  if not currentWorkspace then
    return nil
  end

  generation = generation + 1
  local history = {}
  for index, windowID in ipairs(focusHistory[currentWorkspace] or {}) do
    history[index] = windowID
  end

  return {
    kind = kind,
    workspace = currentWorkspace,
    closingWindowID = currentWindowID,
    quittingPID = pid,
    history = history,
    generation = generation,
    capturedAt = now(),
    closeRechecks = 0,
  }
end

local function focusWorkspace(context)
  runAerospace({ "workspace", "--", context.workspace }, function(exitCode, _, stderr)
    if exitCode ~= 0 and stderr ~= "" then
      log.wf("Could not restore workspace %s: %s", context.workspace, stderr:gsub("%s+$", ""))
    end
  end)
end

local function focusWindow(context, windowID)
  runAerospace({ "focus", "--window-id", tostring(windowID) }, function(exitCode)
    if exitCode ~= 0 and context.generation == generation then
      focusWorkspace(context)
    end
  end)
end

local restoreFocus

restoreFocus = function(context)
  if context.generation ~= generation then
    return
  end

  local started = runAerospace({
    "list-windows",
    "--workspace", context.workspace,
    "--format", "%{window-id}%{tab}%{app-pid}",
  }, function(exitCode, stdout, stderr)
    if context.generation ~= generation then
      return
    end
    if exitCode ~= 0 then
      if stderr ~= "" then
        log.wf("Could not inspect workspace %s: %s", context.workspace, stderr:gsub("%s+$", ""))
      end
      return
    end

    local survivors = {}
    local ordered = {}
    for line in stdout:gmatch("[^\r\n]+") do
      local windowID, pid = line:match("^(%d+)\t(%d+)$")
      windowID, pid = tonumber(windowID), tonumber(pid)
      if windowID and (not context.quittingPID or pid ~= context.quittingPID) then
        survivors[windowID] = true
        table.insert(ordered, windowID)
      end
    end

    if context.kind == "close" and context.closingWindowID and survivors[context.closingWindowID] then
      if context.closeRechecks < 1 then
        context.closeRechecks = context.closeRechecks + 1
        hs.timer.doAfter(CLOSE_RECHECK_DELAY, function()
          restoreFocus(context)
        end)
      end
      return
    end

    for _, windowID in ipairs(context.history) do
      if survivors[windowID] then
        focusWindow(context, windowID)
        return
      end
    end

    if ordered[1] then
      focusWindow(context, ordered[1])
    else
      focusWorkspace(context)
    end
  end)

  if not started then
    log.w("Could not start AeroSpace workspace inspection")
  end
end

local function scheduleRestore(context)
  hs.timer.doAfter(RESTORE_DELAY, function()
    restoreFocus(context)
  end)
end

function M.closeWindow()
  local context = captureContext("close")
  local arguments = { "close" }
  if context and context.closingWindowID then
    arguments = { "close", "--window-id", tostring(context.closingWindowID) }
  end

  local started = runAerospace(arguments, function(exitCode, _, stderr)
    if exitCode == 0 and context then
      scheduleRestore(context)
    elseif exitCode ~= 0 and stderr ~= "" then
      log.wf("AeroSpace close failed: %s", stderr:gsub("%s+$", ""))
    end
  end)

  if not started then
    -- This function runs through Hammerspoon IPC, not an eventtap callback, so a
    -- synchronous last-resort close is safe and preserves the original binding.
    hs.execute(AEROSPACE .. " close >/dev/null 2>&1", false)
  end
end

local function invalidatePendingRestore()
  generation = generation + 1
  pendingQuits = {}
end

local function observeInput(event)
  if event:getType() ~= hs.eventtap.event.types.keyDown then
    invalidatePendingRestore()
    return false
  end

  local isQuit = event:getProperty(hs.eventtap.event.properties.keyboardEventAutorepeat) == 0
    and event:getKeyCode() == hs.keycodes.map.q
    and event:getFlags():containExactly({ "cmd" })
  if not isQuit then
    invalidatePendingRestore()
    return false
  end

  local app = hs.application.frontmostApplication()
  local pid = app and app:pid()
  local context = pid and captureContext("quit", pid)
  if context then
    pendingQuits[pid] = context
  end

  return false
end

local function applicationEvent(_, event, app)
  if event == hs.application.watcher.launched
    and app and app:bundleID() == "bobko.aerospace" then
    subscriberRetries = 0
    startSubscriber()
    return
  end

  if event ~= hs.application.watcher.terminated or not app then
    return
  end

  local pid = app:pid()
  local context = pid and pendingQuits[pid]
  if not context then
    return
  end
  pendingQuits[pid] = nil

  if context.generation == generation and now() - context.capturedAt <= QUIT_TTL then
    scheduleRestore(context)
  end
end

function M.start()
  startSubscriber()
  keyWatcher = hs.eventtap.new({
    hs.eventtap.event.types.keyDown,
    hs.eventtap.event.types.leftMouseDown,
    hs.eventtap.event.types.rightMouseDown,
    hs.eventtap.event.types.otherMouseDown,
  }, observeInput):start()
  appWatcher = hs.application.watcher.new(applicationEvent):start()
end

return M
