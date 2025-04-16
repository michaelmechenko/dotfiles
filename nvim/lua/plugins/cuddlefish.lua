return {
  {
    "comfysage/cuddlefish.nvim",
    config = function()
      require("cuddlefish").setup({
        theme = {
          accent = "cherry",
          -- accent = "violet",
          -- accent = "orange",
        },
        editor = {
          transparent_background = true,
        },
        style = {
          tabline = { "reverse" },
          search = { "italic", "reverse" },
          incsearch = { "italic", "reverse" },
          types = { "italic" },
          keyword = { "italic" },
          comment = { "italic" },
        },
        overrides = function(colors)
          return {}
        end,
      })

      vim.cmd.colorscheme([[cuddlefish]])
    end,
  },
}
