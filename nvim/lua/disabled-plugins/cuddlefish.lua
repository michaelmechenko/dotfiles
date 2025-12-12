return {
  {
    "comfysage/cuddlefish.nvim",
    lazy = true,
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
          return {
            Search = { fg = "#242424", bg = "#bababa" },
            NormalFloat = { bg = "none" },
            FloatBorder = { bg = "none" },
            FloatTitle = { bg = "none" },
            -- CurSearch = { bg = "#1d1d1d" },
            -- CursorColumn = { bg = "#1d1d1d" },
            -- CursorLine = { bg = "#1d1d1d" },
            CurSearch = { bg = "#252525" },
            CursorColumn = { bg = "#252525" },
            CursorLine = { bg = "#252525" },
          }
        end,
      })

      -- vim.cmd.colorscheme([[cuddlefish]])
    end,
  },
}
