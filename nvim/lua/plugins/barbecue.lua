return {
  "utilyre/barbecue.nvim",
  name = "barbecue",
  version = "*",
  dependencies = {
    "SmiteshP/nvim-navic",
    "nvim-tree/nvim-web-devicons", -- optional dependency
  },
  config = function()
    local barbecue = require("barbecue")
    barbecue.setup({
      symbols = {
        separator = "",
      },
      theme = {
        dirname = { fg = "#c4a7e7" },
        basename = { bold = false },
        normal = { fg = "#faf4ed" },
        separator = { fg = "#908caa" },
      },
    })
  end,
}
