return {
  'arnamak/stay-centered.nvim',
  lazy = true,
  keys = { "<leader>st" },
  opts = {
    enabled = false,
    allow_scroll_move = true,
    disable_on_mouse = true,
    skip_filetypes = { "neo-tree", "trouble" }
  },
}
