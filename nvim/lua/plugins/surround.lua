return {
  {
    "kylechui/nvim-surround",
    version = "*", -- Use for stability; omit to use `main` branch for the latest features
    event = "VeryLazy",
    config = function()
      require("nvim-surround").setup({
        keymaps = {
          insert = "<C-g>s",
          insert_line = "<C-g>S",
          normal = "<leader>ss",
          -- normal_cur = "<leader>sc",
          -- normal_line = "<leader>sl",
          -- normal_cur_line = "<leader>sf",
          visual = "<leader>sa",
          visual_line = "<leader>sl",
          delete = "ds",
          change = "cs",
          change_line = "cS",
        },
      })
    end,
  },
}
