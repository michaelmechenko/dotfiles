return {
  "nvim-neo-tree/neo-tree.nvim",
  branch = "v3.x",
  dependencies = {
    "nvim-lua/plenary.nvim",
    "nvim-tree/nvim-web-devicons", -- not strictly required, but recommended
    "MunifTanjim/nui.nvim",
    -- "3rd/image.nvim", -- Optional image support in preview window: See `# Preview Mode` for more information
  },
  config = function()
    require("neo-tree").setup({
      source_selector = {
        winbar = false,
        statusline = false,
      },
      close_if_last_window = true,
    })
    		vim.keymap.set("n", "<leader>rr", ":Neotree filesystem reveal left<CR>", {})
    		vim.keymap.set("n", "<leader>rb", ":Neotree git_status reveal float<CR>", {})
    		vim.keymap.set("n", "<leader>rw", ":Neotree buffers reveal left<CR>", {})
    		vim.keymap.set("n", "<leader>rq", ":Neotree close<CR>", {})
  end,
}
