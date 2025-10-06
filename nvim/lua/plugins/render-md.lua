return {
  {
    "MeanderingProgrammer/render-markdown.nvim",
    -- dependencies = { "nvim-treesitter/nvim-treesitter", "echasnovski/mini.nvim" }, -- if you use the mini.nvim suite
    dependencies = { "nvim-treesitter/nvim-treesitter", "echasnovski/mini.icons" }, -- if you use standalone mini plugins
    -- dependencies = { 'nvim-treesitter/nvim-treesitter', 'nvim-tree/nvim-web-devicons' }, -- if you prefer nvim-web-devicons
    ---@module 'render-markdown'
    ---@type render.md.UserConfig
    opts = {},
    ft = { "markdown", "codecompanion" },
    config = function()
      require("render-markdown").setup({
        heading = {
          sign = true,
          icons = { "- ", "- ", "- ", "- ", "- ", "- " },
          position = "inline",
          width = "block",
          min_width = 35
        },
        indent = {
          enabled = false
        },
        code = {
          enabled = true,
          -- width = 'block',
          -- left_pad = 0.2,
          -- right_pad = 0.2,
          sign = false,
        },
        quote = {
          enabled = false,
        },
        patterns = {
          -- Highlight patterns to disable for filetypes, i.e. lines concealed around code blocks
          markdown = {
            disable = true,
            directives = {
              { id = 17, name = 'conceal_lines' },
              { id = 18, name = 'conceal_lines' },
            },
          },
        },
        anti_conceal = {
          enabled = true,
        },
        bullet = {
          enabled = false,
        },
        checkbox = {
          enabled = false,
        },
        link = {
          enabled = false,
          footnote = {
            enabled = false,
          },
        },
        latex = {
          enabled = false,
          converter = "latex2text",
          highlight = "RenderMarkdownMath",
          top_pad = 0,
          bottom_pad = 0,
        },
      })
    end,
  },
}
