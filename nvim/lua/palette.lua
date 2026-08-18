-- Centralized palette access for nvim plugins.
--
-- Loads the active bundle's generated palette (theme/active/nvim/palette.lua,
-- produced by `theme build`) so vague/lualine/dropbar/devicons reference semantic
-- roles instead of hardcoding hex. The generated file returns a table keyed by
-- role name (e.g. palette["accent-primary"]).
--
-- Falls back to an empty table if the bundle is missing (before the first
-- `theme build`); plugins should treat a missing role as "leave the colorscheme
-- default" rather than erroring.
local M = {}

local path = vim.fn.expand("~/.config/theme/active/nvim/palette.lua")
local ok, generated = pcall(dofile, path)
if ok and type(generated) == "table" then
  M = generated
end

return M
