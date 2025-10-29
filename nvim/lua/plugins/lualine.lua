local oldworld_override = {
  normal = {
    a = { bg = "#bb9af7", fg = "#1b1b1c", gui = "bold" },
    b = { bg = "#27282a", fg = "#bb9af7" },
    c = { fg = "#bb9af7" },
  },
  insert = {
    a = { bg = "#f5919b", fg = "1b1b1c", gui = "bold" },
    b = { fg = "#f5919b" },
    c = { fg = "#f5919b" },
  },
  inactive = {
    a = { bg = "#c9c7cd", fg = "1b1b1c" },
    b = { fg = "#c9c7cd" },
    c = { fg = "#c9c7cd" },
  }
}

local filetype_spacing = {
  sections = {
    lualine_a = {
      { "mode" },
    },
    lualine_b = {
      {
        function()
          return " "
        end,
        padding = 0,
        color = { bg = "None", }
      },
      {
        "buffers",
        show_filename_only = true,       -- Shows shortened relative path when set to false.
        hide_filename_extension = false, -- Hide filename extension when set to true.
        show_modified_status = true,     -- Shows indicator when the buffer is modified.
        padding = { left = 1, right = 1 },
        -- use_mode_colors=true,

        mode = 1,
        -- 0: Shows buffer name
        -- 1: Shows buffer index
        -- 2: Shows buffer name + buffer index
        -- 3: Shows buffer number
        -- 4: Shows buffer name + buffer number

        icons_enabled = false,
        draw_empty = false,
        symbols = {
          modified = "*", -- Text to show when the buffer is modified
          alternate_file = "", -- Text to show to identify the alternate file
          directory = "", -- Text to show when the buffer is a directory
        },
        buffers_color = {
          active = {
            bg = "None", --[[ fg = "#9CABCA", ]]
            gui = "bold"
          },
          inactive = {
            bg = "None", --[[ fg = "#9CABCA", ]]
            fg = "c9c7cd",
          },
        },
      },
    },
    lualine_z = {
      {
        "filename",
        path = 3,
        shorting_target = 40, -- Shortens path to leave 40 spaces in the window
        padding = { left = 0 },
        color = { fg = oldworld_override.normal.b.fg, bg = "None" },
        fmt = function(str)
          return string.match(str, "([^%s]+)"):gsub("neo%-tree$", "")
        end
      },
    }
  },
  -- vim.bo.filetype
  filetypes = { 'neo-tree', 'lazygit', 'codecompanion' }
}

return {
  "nvim-lualine/lualine.nvim",
  dependencies = { "nvim-tree/nvim-web-devicons" },
  config = function()
    require("lualine").setup({
      options = {
        theme = oldworld_override,
        component_separators = '',
        section_separators = '',
        ignore_focus = {},
        always_divide_middle = false,
        globalstatus = true,
        refresh = {
          statusline = 100,
          tabline = 100,
          winbar = 100,
        },
      },
      sections = {
        lualine_a = {
          {
            "mode",
          },
        },
        lualine_b = {
          {
            function()
              return " "
            end,
            padding = 0,
            color = { bg = "None", }
          },
          {
            "buffers",
            show_filename_only = true,       -- Shows shortened relative path when set to false.
            hide_filename_extension = false, -- Hide filename extension when set to true.
            show_modified_status = true,     -- Shows indicator when the buffer is modified.
            padding = { left = 1, right = 1 },
            -- use_mode_colors=true,

            mode = 1,
            -- 0: Shows buffer name
            -- 1: Shows buffer index
            -- 2: Shows buffer name + buffer index
            -- 3: Shows buffer number
            -- 4: Shows buffer name + buffer number

            icons_enabled = false,
            draw_empty = false,
            symbols = {
              modified = "*", -- Text to show when the buffer is modified
              alternate_file = "", -- Text to show to identify the alternate file
              directory = "", -- Text to show when the buffer is a directory
            },
            buffers_color = {
              active = {
                bg = "None", --[[ fg = "#9CABCA", ]]
              },
              inactive = {
                bg = "None", --[[ fg = "#9CABCA", ]]
                fg = "c9c7cd",
              },
            },
          },
        },
        lualine_c = {
          {
            "filename",
            path = 4,
            padding = { left = 0 },
            symbols = {
              modified = '[+]',  -- Text to show when the file is modified.
              readonly = '',     -- Text to show when the file is non-modifiable or readonly.
              unnamed = '',      -- Text to show for unnamed buffers.
              newfile = '[new]', -- Text to show for newly created file before first write
            },
            color = {
              fg = "c9c7cd"
            }
          },
        },
        lualine_x = {
          {
            "diff",
          },
          -- {
          --   "branch",
          --   icons_enabled = false,
          --   padding = { right = 1 }
          -- },
        },
        lualine_y = {
          {
            "diagnostics",
          },
        },
        lualine_z = { { "progress" } },
      },
      inactive_sections = {
        lualine_a = {},
        lualine_b = {},
        lualine_c = { 'filename' },
        lualine_x = { 'location' },
        lualine_y = {},
        lualine_z = {}
      },
      extensions = {
        -- "neo-tree"
        filetype_spacing
      },
    })
  end,
}
