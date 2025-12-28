return {
  {
    "lewis6991/gitsigns.nvim",
    config = function()
      require("gitsigns").setup({
        signcolumn          = true,  -- Toggle with `:Gitsigns toggle_signs`
        numhl               = false, -- Toggle with `:Gitsigns toggle_numhl`
        linehl              = false, -- Toggle with `:Gitsigns toggle_linehl`
        word_diff           = false, -- Toggle with `:Gitsigns toggle_word_diff`
        current_line_blame  = false, -- Toggle with `:Gitsigns toggle_current_line_blame`
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
