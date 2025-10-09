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
  -- add visual
  -- add replace
}

return {
  "nvim-lualine/lualine.nvim",
  dependencies = { "nvim-tree/nvim-web-devicons" },
  config = function()
    require("lualine").setup({
      options = {
        theme = oldworld_override,
        component_separators = { left = "", right = "" },
        section_separators = { left = "", right = "" },
        ignore_focus = {},
        always_divide_middle = true,
        globalstatus = true,
        refresh = {
          statusline = 100,
          tabline = 100,
          winbar = 100,
        },
      },
      sections = {
        lualine_a = { { "mode" } },
        lualine_b = {
          {
            "buffers",
            show_filename_only = true,       -- Shows shortened relative path when set to false.
            hide_filename_extension = false, -- Hide filename extension when set to true.
            show_modified_status = true,     -- Shows indicator when the buffer is modified.
            -- use_mode_colors=true,

            mode = 2,
            -- 0: Shows buffer name
            -- 1: Shows buffer index
            -- 2: Shows buffer name + buffer index
            -- 3: Shows buffer number
            -- 4: Shows buffer name + buffer number

            max_length = vim.o.columns * 3 / 4, -- Maximum width of buffers component,
            -- it can also be a function that returns
            -- the value of `max_length` dynamically.

            component_separators = { left = "", right = "" },
            icons_enabled = false,
            draw_empty = false,
            symbols = {
              modified = " *", -- Text to show when the buffer is modified
              alternate_file = "", -- Text to show to identify the alternate file
              directory = " ", -- Text to show when the buffer is a directory
            },
            buffers_color = {
              active = {
                bg = "None", --[[ fg = "#9CABCA", ]]
                -- fg = "#afc3ed",
                -- fg = "#e6b99d",
                -- fg = "#f5919b",
                -- gui = "bold",
              },
              inactive = {
                bg = "None", --[[ fg = "#9CABCA", ]]
                fg = "c9c7cd",
                -- gui = "italic",
              },
            },
            filetype_names = {
              fzf = "fuzzy",
              alpha = "home",
            },
          },
        },
        lualine_c = {
          {
            color = { bg = "None" },
          },
        },
        lualine_x = {
          -- {
          --   'lsp_status',
          --   icon = '', -- f013
          --   symbols = {
          --     -- Standard unicode symbols to cycle through for LSP progress:
          --     spinner = { '⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏' },
          --     -- Standard unicode symbol for when LSP is done:
          --     done = '✓',
          --     -- Delimiter inserted between LSP names:
          --     separator = ' ',
          --   },
          --   -- List of LSP names to ignore (e.g., `null-ls`):
          --   ignore_lsp = { "null-ls" },
          -- },
          {
            "branch",
            icon = "",
            color = { bg = "None" },
          },
        },
        lualine_y = {
          {
            color = { bg = "None" },
            "diff",
          },
          {
            "diagnostics",
          }
        },
        lualine_z = { { "progress" } },
      },
      -- tabline = {
      -- 	lualine_b = {
      -- 		{
      -- 			"buffers",
      -- 			component_separators = { left = "", right = "" },
      -- 			mode = 2,
      -- 			icons_enabled = false,
      -- 			symbols = {
      -- 				modified = " *", -- Text to show when the buffer is modified
      -- 				alternate_file = "", -- Text to show to identify the alternate file
      -- 				directory = " ", -- Text to show when the buffer is a directory
      -- 			},
      -- 			buffers_color = {
      -- 				active = {
      -- 					bg = "None", --[[ fg = "#9CABCA", ]]
      -- 					gui = "italic,bold",
      -- 				},
      -- 				inactive = { bg = "None", fg = "#57576b" },
      -- 			},
      -- 			filetype_names = {
      -- 				TelescopePrompt = "file explorer",
      -- 				fzf = "fuzzy",
      -- 				alpha = "home",
      -- 			},
      -- 		},
      -- 	},
      -- 	lualine_c = {
      -- 		{
      -- 			color = { bg = "None", fg = "#57576b" },
      -- 		},
      -- 	},
      -- 	lualine_x = {
      -- 		{
      -- 			color = { bg = "None", fg = "#57576b" },
      -- 		},
      -- 	},
      -- 	lualine_y = {
      -- 		{
      -- 			"branch",
      -- 			color = { bg = "None", fg = "#57576b" },
      -- 			icons_enabled = false,
      -- 		},
      -- 	},
      -- },
      extensions = {
        -- "neo-tree"
      },
    })
  end,
}
