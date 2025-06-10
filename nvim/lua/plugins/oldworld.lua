return {
  {
    "dgox16/oldworld.nvim",
    lazy = false,
    priority = 1000,
    config = function()
      require("oldworld").setup({
        terminal_colors = true,    -- enable terminal colors
        variant = "cooler",       -- default, oled, cooler
        styles = {                 -- You can pass the style using the format: style = true
          comments = { italic = true }, -- style for comments
          keywords = { bold = true }, -- style for keywords
          identifiers = {},        -- style for identifiers
          functions = { bold = true }, -- style for functions
          variables = { bold = false }, -- style for variables
          booleans = {},           -- style for booleans
        },
        integrations = {           -- You can disable/enable integrations
          alpha = true,
          cmp = true,
          flash = true,
          gitsigns = true,
          hop = false,
          indent_blankline = true,
          lazy = true,
          lsp = true,
          markdown = true,
          mason = true,
          navic = false,
          neo_tree = false,
          neogit = false,
          neorg = false,
          noice = true,
          notify = true,
          rainbow_delimiters = true,
          telescope = true,
          treesitter = true,
        },
        highlight_overrides = {
          CursorLineNr = { bold = true },
          Variable = { fg = "#938AA9" }
        },
      })
      -- vim.cmd("colorscheme oldworld")
    end,
  },
}
