return {
  {
    "vague-theme/vague.nvim",
    lazy = true,
    priority = 1000,
    config = function()
      local palette = require("palette")
      require("vague").setup({
        transparent = true,
        bold = true,
        italic = true,
        style = {
          boolean = "none",
          number = "none",
          float = "none",
          error = "bold",
          comments = "italic",
          keyword_return = "italic",
        },
        colors = { fg = palette["text"] },
      })
    end,
  },
}
