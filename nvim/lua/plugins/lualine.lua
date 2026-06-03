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
        color = { bg = "#1c1c24", }
      },
      {
        "buffers",
        show_filename_only = true,       -- Shows shortened relative path when set to false.
        hide_filename_extension = false, -- Hide filename extension when set to true.
        show_modified_status = true,     -- Shows indicator when the buffer is modified.
        padding = { left = 1, right = 1 },
        use_mode_colors = true,

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
            -- bg = "None", --[[ fg = "#9CABCA", ]]
            bg = "#1c1c24",
            gui = "bold"
          },
          inactive = {
            -- bg = "None", --[[ fg = "#9CABCA", ]]
            bg = "#1c1c24",
            fg = "#656a80",
          },
        },
      },
    },
    -- lualine_z = {
    --   {
    --     "filename",
    --     path = 3,
    --     shorting_target = 40, -- Shortens path to leave 40 spaces in the window
    --     padding = { left = 0 },
    --     color = { fg = oldworld_override.normal.b.fg, bg = "None" },
    --     fmt = function(str)
    --       return string.match(str, "([^%s]+)"):gsub("neo%-tree$", "")
    --     end
    --   },
    -- }
  },
  -- vim.bo.filetype
  filetypes = { 'neo-tree', 'lazygit', 'codecompanion' }
}

-- Inline lualine theme. Upstream vague.nvim removed its shipped lualine theme
-- (commit f911602), so theme='auto' fell back to lualine's default. Define it
-- here to own the statusline colors. Section mapping is fixed: a+z -> .a,
-- b+y -> .b, c+x -> .c. Whole bar is surface-chrome #1C1C24; only a/z (status
-- and location) carry the per-mode accent.
local chrome = "#1C1C24"       -- surface-chrome (whole bar bg)
local chrome_fg = "#BEBEBE"    -- text
local block_fg = "#100E11"     -- canvas (dark text on accent block)
local inactive_fg = "#656a80"  -- text-muted

local function mode(accent)
  return {
    a = { fg = block_fg, bg = accent, gui = "bold" },
    b = { fg = chrome_fg, bg = chrome },
    c = { fg = chrome_fg, bg = chrome },
  }
end

local vague_lualine = {
  normal   = mode("#aeaed1"), -- accent-secondary
  insert   = mode("#f3be7c"), -- accent-amber
  visual   = mode("#bb9dbd"), -- accent-tertiary
  replace  = mode("#d8647e"), -- accent-primary
  command  = mode("#aeaed1"), -- accent-secondary
  inactive = {
    a = { fg = inactive_fg, bg = chrome },
    b = { fg = inactive_fg, bg = chrome },
    c = { fg = inactive_fg, bg = chrome },
  },
}

return {
  "nvim-lualine/lualine.nvim",
  dependencies = { "nvim-tree/nvim-web-devicons" },
  config = function()
    require("lualine").setup({
      options = {
        theme = vague_lualine,
        component_separators = '',
        section_separators = '',
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
            -- color = { bg = "None", }
            color = { bg = "#1c1c24" }
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
                -- bg = "None", --[[ fg = "#9CABCA", ]]
                -- gui = "bold"
                bg = "#1c1c24"
              },
              inactive = {
                -- bg = "None", --[[ fg = "#9CABCA", ]]
                bg = "#1c1c24",
                fg = "#656a80",
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
            -- color = {
            --   fg = "c9c7cd",
            --   bg = "None"
            -- }
          },
        },
        lualine_x = {
          {
            "diff",
            -- color = {
            --   fg = "c9c7cd",
            --   bg = "None"
            -- }
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
