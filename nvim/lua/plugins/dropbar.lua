return {
  {
    'Bekaboo/dropbar.nvim',
    -- optional, but required for fuzzy finder support
    dependencies = {
      'nvim-telescope/telescope-fzf-native.nvim',
      build = 'make'
    },
    opts = {
    },
    config = function()
      local dropbar_api = require('dropbar.api')
      vim.keymap.set('n', '<Leader>;', dropbar_api.pick, { desc = 'Pick symbols in winbar' })
      vim.keymap.set('n', '[;', dropbar_api.goto_context_start, { desc = 'Go to start of current context' })
      vim.keymap.set('n', '];', dropbar_api.select_next_context, { desc = 'Select next context' })
      require('dropbar').setup({
        sources = {
          path = {
            max_depth = 1
          }
        }
      })

      -- Equal WinBar/WinBarNC disables dimming
      vim.api.nvim_set_hl(0, 'WinBar', { fg = '#c3c3c3', bg = '#1C1C24' })
      vim.api.nvim_set_hl(0, 'WinBarNC', { fg = '#c3c3c3', bg = '#1C1C24' })
      vim.api.nvim_set_hl(0, 'DropBarIconKindDefault', { fg = '#656a80' })

      -- Link all specific icon kinds to the default (skips NC variants)
      for _, name in ipairs(vim.fn.getcompletion('DropBarIconKind', 'highlight')) do
        if not name:match('NC$') and name ~= 'DropBarIconKindDefault' then
          vim.api.nvim_set_hl(0, name, { link = 'DropBarIconKindDefault' })
        end
      end

      vim.api.nvim_create_autocmd('ColorScheme', {
        callback = function()
          vim.api.nvim_set_hl(0, 'WinBar', { fg = '#c3c3c3', bg = '#1C1C24' })
          vim.api.nvim_set_hl(0, 'WinBarNC', { fg = '#c3c3c3', bg = '#1C1C24' })
          vim.api.nvim_set_hl(0, 'DropBarIconKindDefault', { fg = '#656a80' })
          for _, name in ipairs(vim.fn.getcompletion('DropBarIconKind', 'highlight')) do
            if not name:match('NC$') and name ~= 'DropBarIconKindDefault' then
              vim.api.nvim_set_hl(0, name, { link = 'DropBarIconKindDefault' })
            end
          end
        end,
      })
    end,
  }
}
