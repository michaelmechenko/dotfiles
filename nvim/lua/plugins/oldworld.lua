return {
  {
    "dgox16/oldworld.nvim",
    lazy = false,
    priority = 1000,
    config = function()
      require("oldworld").setup({
        terminal_colors = false,
        variant = "cooler",
        styles = {
          comments = { italic = true },
          keywords = { bold = false },
          identifiers = {},
          functions = { italic = true, bold = false },
          variables = { bold = false },
          booleans = { italic = true },
        },
        integrations = {
          alpha = true,
          cmp = true,
          flash = true,
          gitsigns = true,
          indent_blankline = true,
          lazy = true,
          lsp = true,
          markdown = true,
          mason = true,
          neo_tree = true,
          noice = true,
          notify = true,
        },
        highlight_overrides = {
          CursorLineNr = { bold = true },
          Normal = { bg = "none" },
          NormalFloat = { bg = "none" },
          FloatBorder = { bg = "none" },
          Pmenu = { bg = "none" },
          NeoTreeFloatTitle = { bg = "none" },
        },
      })
    end,
  },
}
