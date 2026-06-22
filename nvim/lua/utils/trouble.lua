local M = {}

-- mode-specific fold levels
-- symbols/lsp_document_symbols have a deeper tree (file -> class -> method),
-- so open one more level than diagnostics (file -> diagnostic).
local fold_levels = {
  symbols_main = 3,
  symbols_right = 3,
  functions_main = 3,
  lsp_main = 3,
  lsp_references = 3,
  lsp_declarations = 3,
  lsp_type_definitions = 3,
  diagnostics = 2,
  diagnostics_right = 2,
  qflist = 2,
}

local default_fold_level = 2

local function get_trouble()
  return require("trouble")
end

function M.open(mode, opts)
  local trouble = get_trouble()
  opts = vim.tbl_deep_extend("force", { mode = mode, focus = true }, opts or {})
  local view = trouble.open(opts)
  if view then
    view:wait(function()
      view:fold_level({ level = fold_levels[mode] or default_fold_level })
    end)
  end
  return view
end

function M.toggle(mode)
  local trouble = get_trouble()
  if trouble.is_open(mode) then
    return trouble.close(mode)
  end
  return M.open(mode)
end

return M