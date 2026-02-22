return {
  {
    "lewis6991/gitsigns.nvim",
    config = function()
      require("gitsigns").setup({
        signs               = {
          add          = { text = '┃' },
          change       = { text = '┃' },
          delete       = { text = '┃' },
          topdelete    = { text = '┃' },
          changedelete = { text = '┃' },
          untracked    = { text = '┆' },
        },
        signs_staged        = {
          add          = { text = '┃' },
          change       = { text = '┃' },
          delete       = { text = '┃' },
          topdelete    = { text = '┃' },
          changedelete = { text = '┃' },
          untracked    = { text = '┆' },
        },
        signcolumn          = true,
        numhl               = true,
        linehl              = false,
        word_diff           = false,
        current_line_blame  = false,
        signs_staged_enable = true,

        on_attach           = function(bufnr)
          local gitsigns = require('gitsigns')

          local function map(mode, l, r, opts)
            opts = opts or {}
            opts.buffer = bufnr
            vim.keymap.set(mode, l, r, opts)
          end

          -- Navigation
          map('n', ']c', function()
            if vim.wo.diff then
              vim.cmd.normal({ ']c', bang = true })
            else
              gitsigns.nav_hunk('next')
            end
          end)

          map('n', '[c', function()
            if vim.wo.diff then
              vim.cmd.normal({ '[c', bang = true })
            else
              gitsigns.nav_hunk('prev')
            end
          end)
        end
      })
    end,
  },
}
