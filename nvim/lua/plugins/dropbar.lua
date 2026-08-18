return {
  {
    'Bekaboo/dropbar.nvim',
    -- optional, but required for fuzzy finder support
    dependencies = {},
    opts = {},
    config = function()
      local dropbar_api = require('dropbar.api')
      local palette = require('palette')
      local winbar_fg = palette["text-ui"] or "#9094A0"
      local winbar_bg = palette["surface-chrome"] or "#1C1C24"
      local icon_fg = palette["text-muted"] or "#656a80"
      vim.keymap.set('n', '<Leader>;', dropbar_api.pick, { desc = 'Pick symbols in winbar' })
      vim.keymap.set('n', '[;', dropbar_api.goto_context_start, { desc = 'Go to start of current context' })
      vim.keymap.set('n', '];', dropbar_api.select_next_context, { desc = 'Select next context' })
      require('dropbar').setup({
        -- Path-only winbar: filename plus at most 5 parent directories.
        -- max_depth counts the filename, so 6 = five parents + the file.
        -- Drops the default LSP / Treesitter / Markdown / terminal context sources.
        bar = {
          sources = function(_, _)
            return { require('dropbar.sources').path }
          end,
        },
        sources = {
          path = {
            max_depth = 6
          }
        }
      })

      -- Equal WinBar/WinBarNC disables dimming
      vim.api.nvim_set_hl(0, 'WinBar', { fg = winbar_fg, bg = winbar_bg })
      vim.api.nvim_set_hl(0, 'WinBarNC', { fg = winbar_fg, bg = winbar_bg })
      vim.api.nvim_set_hl(0, 'DropBarIconKindDefault', { fg = icon_fg })

      -- Link all specific icon kinds to the default (skips NC variants)
      for _, name in ipairs(vim.fn.getcompletion('DropBarIconKind', 'highlight')) do
        if not name:match('NC$') and name ~= 'DropBarIconKindDefault' then
          vim.api.nvim_set_hl(0, name, { link = 'DropBarIconKindDefault' })
        end
      end

      vim.api.nvim_create_autocmd('ColorScheme', {
        callback = function()
          vim.api.nvim_set_hl(0, 'WinBar', { fg = winbar_fg, bg = winbar_bg })
          vim.api.nvim_set_hl(0, 'WinBarNC', { fg = winbar_fg, bg = winbar_bg })
          vim.api.nvim_set_hl(0, 'DropBarIconKindDefault', { fg = icon_fg })
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