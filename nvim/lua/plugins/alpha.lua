return {
  "goolord/alpha-nvim",
  dependencies = {
    "nvim-tree/nvim-web-devicons",
    "nvim-lua/plenary.nvim",
  },
  config = function()
    local dashboard = require("alpha.themes.dashboard")
    dashboard.section.header.val = {
      "",
      "notepad",
      "",
    }

    local buttonhl = function(shortcut, text, command, hl, position)
      local button = dashboard.button(shortcut, text, command)
      button.opts.hl_shortcut = hl
      button.opts.position = position
      return button
    end

    dashboard.section.buttons.val = {
      buttonhl("e", "     ‹ new file ›", "<cmd>ene<CR>", "Conceal", "center"),
      buttonhl("f", "     ‹ find files ›", "<cmd>Telescope find_files<CR>", "Conceal", "center"),
      buttonhl("g", "     ‹ live grep ›", "<cmd>Telescope live_grep<CR>", "Conceal", "center"),
      buttonhl("r", "     ‹ recent files ›", "<cmd>Telescope oldfiles<CR>", "Conceal", "center"),
      buttonhl("u", "     ‹ update lazy ›", "<cmd>Lazy sync<CR>", "Conceal", "center"),
      buttonhl("l", "     ‹ update mason ›", "<cmd>MasonUpdate<CR>", "Conceal", "center"),
      buttonhl("q", "     ‹ quit ›", "<cmd>qa<CR>", "Conceal", "center"),
    }

    require("alpha").setup(dashboard.opts)
  end,
}
