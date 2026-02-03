return {
  {
    "MeanderingProgrammer/render-markdown.nvim",
    dependencies = { "nvim-treesitter/nvim-treesitter", "echasnovski/mini.icons" }, -- if you use standalone mini plugins
    ft = { "markdown", "codecompanion" },
    config = function()
      require("render-markdown").setup({
        enabled = true,
        heading = {
          sign = true,
          icons = { "# ", "## ", "### ", "# ", "## ", "### " },
          position = "inline",
          width = "block",
          -- min_width = 35
          -- border = true,
          -- above = '',
          -- below = '-',
          backgrounds = {
            'None',
            'None',
            'None',
            'None',
            'None',
            'None',
          },
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
          conceal_delimiters = false,
        },
        quote = {
          enabled = false,
        },
        bullet = {
          enabled = false,
        },
        checkbox = {
          enabled = true,
        },
        link = {
          enabled = false,
          render_modes = false,
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
