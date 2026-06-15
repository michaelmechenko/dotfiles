return {
  {
    "MeanderingProgrammer/render-markdown.nvim",
    dependencies = { "nvim-treesitter/nvim-treesitter", "echasnovski/mini.icons" }, -- if you use standalone mini plugins
    ft = { "markdown", "codecompanion" },
    config = function()
      require("render-markdown").setup({
        enabled = true,
        anti_conceal = {
          enabled = true,
          disabled_modes = { "n" },
        },
        heading = {
          sign = true,
          icons = { "# ", "## ", "### ", "#### ", "#### ", "#### " },
          position = "inline",
          width = "block",
          border = true,
          border_virtual = true,
          border_prefix = true,
          above = " ",
          below = "─",
          backgrounds = {
            "RenderMarkdownH1Bg",
            "RenderMarkdownH2Bg",
            "RenderMarkdownH3Bg",
            "RenderMarkdownH4Bg",
            "RenderMarkdownH5Bg",
            "RenderMarkdownH6Bg",
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
          conceal_delimiters = true,
        },
        quote = {
          enabled = true,
        },
        bullet = {
          enabled = false,
        },
        checkbox = {
          enabled = true,
        },
        link = {
          enabled = false,
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
