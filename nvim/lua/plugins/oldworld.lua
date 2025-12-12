return {
  {
    "dgox16/oldworld.nvim",
    lazy = true,
    priority = 1000,
    config = function()
      require("oldworld").setup({
        terminal_colors = false,        -- enable terminal colors
        variant = "cooler",            -- default, oled, cooler
        styles = {                      -- You can pass the style using the format: style = true
          comments = { italic = true }, -- style for comments
          keywords = { bold = false },  -- style for keywords
          identifiers = {},             -- style for identifiers
          functions = { italic = true, bold = false },  -- style for functions
          variables = { bold = false }, -- style for variables
          booleans = {italic = true},                -- style for booleans
        },
        integrations = {                -- You can disable/enable integrations
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
          neo_tree = true,
          neogit = false,
          neorg = false,
          noice = true,
          notify = true,
          rainbow_delimiters = false,
          telescope = false,
          treesitter = false,
        },
        highlight_overrides = {
          CursorLineNr = { bold = true },
          -- Variable = { fg = "#938AA9" },
          Normal = { bg = 'none' },
          NormalFloat = { bg = 'none' },
          FloatBorder = { bg = 'none' },
          Pmenu = { bg = 'none' },
          NeoTreeFloatTitle = { bg = 'none' }
        },
      })
      -- vim.cmd("colorscheme oldworld")
    end,
  },
}
