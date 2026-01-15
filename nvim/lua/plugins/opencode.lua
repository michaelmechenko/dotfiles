return {
  {
    "NickvanDyke/opencode.nvim",
    dependencies = {
      { "folke/snacks.nvim", opts = { input = {}, picker = {}, terminal = {} } },
    },
    config = function()
      provider = {
        enabled = "tmux",
        tmux = {
          options = "-h", -- Open in a horizontal split
        }
      }
    end,
  }
}
