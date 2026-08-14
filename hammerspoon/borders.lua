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
    hs.timer.doAfter(1, function()
      os.execute("/opt/homebrew/bin/sketchybar --trigger aerospace_focus_change 2>/dev/null")
    end)
    hs.alert.show("borders: on")
    return
  end

  -- SketchyBar's frontapps plugin also invokes `borders apply-to=...`. With
  -- no daemon, that command becomes a new foreground daemon, so this flag
  -- must be written before killing the process and checked by frontapps.sh.
  local flag = assert(io.open(DISABLED_FLAG, "w"))
  flag:close()
  os.execute("killall borders 2>/dev/null")
  hs.alert.show("borders: off")
end

return M
