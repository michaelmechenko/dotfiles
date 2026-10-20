local M = {}

local HOME = os.getenv("HOME") or ""
local BORDERS_RC = HOME .. "/.config/borders/bordersrc"
local DISABLED_FLAG = "/tmp/borders_disabled"

function M.toggle()
  if hs.fs.attributes(DISABLED_FLAG) then
    os.remove(DISABLED_FLAG)
    hs.execute(
      "( nohup /bin/bash " .. BORDERS_RC .. " >/dev/null 2>&1 & ) >/dev/null 2>&1 &",
      false
    )
    hs.alert.show("borders: on")
    return
  end

  -- This flag is the authoritative disabled state across Hammerspoon reloads.
  -- Write it before killing the daemon so the next toggle can restore it deliberately.
  local flag = assert(io.open(DISABLED_FLAG, "w"))
  flag:close()
  os.execute("killall borders 2>/dev/null")
  hs.alert.show("borders: off")
end

return M
