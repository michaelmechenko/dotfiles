return {
  {
    "echasnovski/mini.icons",
    version = false,
    config = function()
      require("mini.icons").setup()
    end,
  },
  {
    "echasnovski/mini.files",
    version = false,
    config = function()
      require("mini.files").setup({
        options = {
          use_as_default_explorer = true,
        },
        mappings = {
          go_in_plus = "e",
        },
        windows = {
          preview = false,
          -- Width of focused window
          width_focus = 35,
          -- Width of non-focused window
          width_nofocus = 35,
          -- Width of preview window
          width_preview = 35,
        },
      })
      vim.api.nvim_create_autocmd("User", {
        pattern = "MiniFilesWindowUpdate",
        command = [[set relativenumber]],
      })
      vim.api.nvim_create_autocmd("User", {
        pattern = "MiniFilesWindowOpen",
        command = [[set relativenumber]],
      })

      -- Center only the initial explorer opened from `nvim <directory>`.
      -- Later `<leader>e` explorers keep mini.files' normal top-left layout.
      local argv = vim.fn.argv()
      local center_next = #argv == 1 and vim.fn.isdirectory(argv[1]) == 1
      local center_active = false

      vim.api.nvim_create_autocmd("User", {
        pattern = "MiniFilesExplorerClose",
        callback = function() center_active = false end,
      })

      vim.api.nvim_create_autocmd("User", {
        pattern = "MiniFilesWindowUpdate",
        callback = function()
          if center_next then
            center_active, center_next = true, false
          end
          if not center_active then return end

          local state = MiniFiles.get_explorer_state()
          if not state or not state.windows or #state.windows == 0 then return end

          local widths, total_width, max_height = {}, 0, 0
          for i, entry in ipairs(state.windows) do
            local config = vim.api.nvim_win_get_config(entry.win_id)
            widths[i] = config.width
            total_width = total_width + config.width + 2
            max_height = math.max(max_height, config.height)
          end

          local tabline = (vim.o.showtabline == 2
              or (vim.o.showtabline == 1 and #vim.api.nvim_list_tabpages() > 1)) and 1 or 0
          local bottom = (vim.o.laststatus > 0 and 1 or 0) + vim.o.cmdheight
          local usable_height = math.max(0, vim.o.lines - tabline - bottom)
          local row = math.max(tabline, tabline + math.floor((usable_height - max_height - 2) / 2))
          local col = math.max(0, math.floor((vim.o.columns - total_width) / 2))

          for i, entry in ipairs(state.windows) do
            local config = vim.api.nvim_win_get_config(entry.win_id)
            if config.row ~= row or config.col ~= col then
              vim.api.nvim_win_set_config(entry.win_id, {
                relative = "editor",
                row = row,
                col = col,
              })
            end
            col = col + widths[i] + 2
          end
        end,
      })
    end,
  },
}
