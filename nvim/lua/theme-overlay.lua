-- Semantic chrome shared by every native colorscheme.
-- The active bundle supplies these roles; this module owns only cross-plugin UI.
local M = {}

function M.apply()
  local p = require("palette")
  local function c(role) return p[role] end
  local function set(name, value) vim.api.nvim_set_hl(0, name, value) end

  set("@markup.heading.markdown", { fg = c("accent-tertiary"), bg = "NONE" })
  set("@markup.heading.1.markdown", { fg = c("accent-tertiary"), bg = "NONE" })
  set("@markup.heading.2.markdown", { fg = c("accent-secondary"), bg = "NONE" })
  set("@markup.heading.3.markdown", { fg = c("accent-amber"), bg = "NONE" })
  set("@markup.heading.4.markdown", { fg = c("accent-tertiary"), bg = "NONE" })
  set("@markup.heading.5.markdown", { fg = c("accent-secondary"), bg = "NONE" })
  set("@markup.heading.6.markdown", { fg = c("accent-amber"), bg = "NONE" })
  set("@markup.italic", { fg = c("accent-amber"), italic = true, bg = "NONE" })
  set("@markup.strong", { fg = c("text"), bold = true, bg = "NONE" })

  set("SnacksIndent", { fg = c("divider-subtle") })
  set("NeoTreeIndentMarker", { fg = c("divider-subtle") })
  set("GitSignsAdd", { fg = c("accent-tertiary") })
  set("GitSignsDelete", { fg = c("accent-primary") })
  set("GitSignsChange", { fg = c("accent-amber") })
  set("DiffAdd", { bg = c("surface-heading-h2") })
  set("DiffDelete", { bg = c("surface-tint-rose") })
  set("CursorLine", { bg = c("surface-highlight") })
  set("FoldColumn", { fg = c("accent-info") })
  set("FloatBorder", { fg = c("text-muted") })
  set("BlinkCmpGhostText", { fg = c("copy-mode-indicator") })
  set("LspInlayHint", { fg = c("copy-mode-indicator"), italic = true })
  set("GitSignsCurrentLineBlame", { fg = c("copy-mode-indicator") })
  set("ComplHint", { fg = c("copy-mode-indicator") })

  for i, role in ipairs({ "surface-heading-h1", "surface-heading-h2", "surface-heading-h3" }) do
    set("RenderMarkdownH" .. i .. "Bg", { bg = c(role) })
    set("RenderMarkdownH" .. (i + 3) .. "Bg", { bg = c(role) })
  end
  set("RenderMarkdownCodeInline", { fg = c("accent-periwinkle"), bg = "NONE" })
  set("RenderMarkdownTableHead", { fg = c("accent-periwinkle") })
  set("RenderMarkdownTableRow", { fg = c("accent-periwinkle") })
end

function M.setup()
  local group = vim.api.nvim_create_augroup("ThemeSemanticOverlay", { clear = true })
  vim.api.nvim_create_autocmd("ColorScheme", { group = group, callback = M.apply })
end

return M
