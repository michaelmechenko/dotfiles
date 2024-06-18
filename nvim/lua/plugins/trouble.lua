return {
  "folke/trouble.nvim",
  dependencies = { "nvim-tree/nvim-web-devicons" },
  vim.keymap.set("n", "<leader>xx", function()
    require("trouble").toggle("diagnostics")
    require("trouble").focus({true})
  end),
  vim.keymap.set("n", "<leader>xq", function()
    require("trouble").toggle("quickfix")
    require("trouble").focus({true})
  end),
  vim.keymap.set("n", "<leader>xl", function()
    require("trouble").toggle("loclist")
    require("trouble").focus({true})
  end),
  vim.keymap.set("n", "<leader>xr", function()
    require("trouble").toggle("lsp_references")
    require("trouble").focus({true})
  end),
  opts = {
    modes = {
      preview_float = {
        mode = "diagnostics",
        preview = {
          type = "float",
          relative = "editor",
          border = "rounded",
          title = "Preview",
          title_pos = "center",
          position = { 0, -2 },
          size = { width = 0.3, height = 0.3 },
          zindex = 200,
        },
      },
    },
  },
}
