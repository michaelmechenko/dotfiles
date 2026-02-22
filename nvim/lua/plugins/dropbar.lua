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
            max_depth = 3
          }
        }
      })

      -- Set all dropbar icons to #606079, text to #656a80
      local function set_dropbar_colors()
        local icon_color = '#656a80'
        local text_color = '#9396a6'

        -- Set text color via WinBar (preserve existing background)
        local winbar_bg = vim.api.nvim_get_hl(0, { name = 'WinBar' }).bg
        local winbarnc_bg = vim.api.nvim_get_hl(0, { name = 'WinBarNC' }).bg
        vim.api.nvim_set_hl(0, 'WinBar', { fg = text_color, bg = winbar_bg })
        vim.api.nvim_set_hl(0, 'WinBarNC', { fg = text_color, bg = winbarnc_bg })

        -- Set icon color (preserve background)
        local icon_kind_default_bg = vim.api.nvim_get_hl(0, { name = 'DropBarIconKindDefault' }).bg
        vim.api.nvim_set_hl(0, 'DropBarIconKindDefault', { fg = icon_color, bg = icon_kind_default_bg })

        local separator_bg = vim.api.nvim_get_hl(0, { name = 'DropBarIconUISeparator' }).bg
        vim.api.nvim_set_hl(0, 'DropBarIconUISeparator', { fg = icon_color, bg = separator_bg })

        -- Link all DropBarIconKind* groups to DropBarIconKindDefault
        local hlgroups = vim.api.nvim_get_hl(0, {})
        for name, _ in pairs(hlgroups) do
          if name:match('^DropBarIconKind') and name ~= 'DropBarIconKindDefault' and not name:match('NC$') then
            vim.api.nvim_set_hl(0, name, { link = 'DropBarIconKindDefault' })
          end
        end

        -- Override DevIcon* groups from nvim-web-devicons (file-specific icons)
        local devicons = vim.api.nvim_get_hl(0, {})
        for name, _ in pairs(devicons) do
          if name:match('^DevIcon') then
            local devicon_bg = vim.api.nvim_get_hl(0, { name = name }).bg
            vim.api.nvim_set_hl(0, name, { fg = icon_color, bg = devicon_bg })
          end
        end

        -- Also directly set common file extension icons
        local common_icons = {
          'DevIconLua', 'DevIconTs', 'DevIconTsx', 'DevIconJs', 'DevIconJsx',
          'DevIconPy', 'DevIconGo', 'DevIconRs', 'DevIconJson', 'DevIconYaml',
          'DevIconYml', 'DevIconToml', 'DevIconMd', 'DevIconHtml', 'DevIconCss',
          'DevIconSh', 'DevIconBash', 'DevIconZsh', 'DevIconVue', 'DevIconSvelte'
        }
        for _, icon in ipairs(common_icons) do
          local bg = vim.api.nvim_get_hl(0, { name = icon }).bg
          vim.api.nvim_set_hl(0, icon, { fg = icon_color, bg = bg })
        end
      end

      -- Run after plugins load to ensure all hl groups exist
      vim.defer_fn(set_dropbar_colors, 100)
      vim.api.nvim_create_autocmd('ColorScheme', { callback = set_dropbar_colors })
    end,
  }
}
