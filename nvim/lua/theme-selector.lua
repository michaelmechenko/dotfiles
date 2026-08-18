-- Loads the generated native-theme metadata from the active canonical bundle.
local M = {}

local native_path = vim.fn.expand("~/.config/theme/active/nvim/native.lua")

function M.apply()
  local ok, native = pcall(dofile, native_path)
  if not ok or type(native) ~= "table" or type(native.name) ~= "string" then
    vim.notify("active theme has no valid Neovim selector metadata", vim.log.levels.ERROR)
    return false
  end
  for key, value in pairs(native.globals or {}) do
    vim.g[key] = value
  end
  local loaded, err = pcall(vim.cmd.colorscheme, native.name)
  if not loaded then
    vim.notify("failed to load colorscheme " .. native.name .. ": " .. err, vim.log.levels.ERROR)
    return false
  end
  require("theme-overlay").apply()
  return true
end

return M
