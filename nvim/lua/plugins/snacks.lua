-- require("kanagawa").load("wave")

return {
  {
    "folke/snacks.nvim",
    priority = 1000,
    lazy = false,
    opts = {
      bigfile = { enabled = true },

      notifier = { enabled = false },

      quickfile = { enabled = true },

      -- statuscolumn = { enabled = true },

      -- words = { enabled = true },

      explorer = {},

      picker = {
        sources = {
          files = {
            finder = "files",
            format = "file",
            show_empty = true,
            hidden = false,
            ignored = false,
            follow = false,
            supports_live = true,
          },
          explorer = {
            finder = "explorer",
            sort = { fields = { "sort" } },
            supports_live = true,
            tree = true,
            watch = true,
            diagnostics = true,
            diagnostics_open = false,
            git_status = true,
            git_status_open = false,
            -- ignored = true,
            git_untracked = true,
            follow_file = true,
            focus = "list",
            auto_close = false,
            jump = { close = false },
            -- layout = { preset = "sidebar", preview = false },
            -- to show the explorer to the right, add the below to
            -- your config under `opts.picker.sources.explorer`
            layout = { layout = { position = "right" } },
            formatters = {
              file = { filename_only = true },
              severity = { pos = "right" },
            },
            matcher = { sort_empty = false, fuzzy = false },
            config = function(opts)
              return require("snacks.picker.source.explorer").setup(opts)
            end,
            win = {
              list = {
                keys = {
                  ["<BS>"] = "explorer_up",
                  ["e"] = "confirm",
                  ["h"] = "explorer_close", -- close directory
                  ["a"] = "explorer_add",
                  ["d"] = "explorer_del",
                  ["r"] = "explorer_rename",
                  ["c"] = "explorer_copy",
                  ["m"] = "explorer_move",
                  ["o"] = "explorer_open", -- open with system application
                  ["P"] = "toggle_preview",
                  ["y"] = { "explorer_yank", mode = { "n", "x" } },
                  ["p"] = "explorer_paste",
                  ["u"] = "explorer_update",
                  ["<c-c>"] = "tcd",
                  ["<leader>/"] = "picker_grep",
                  -- ["<c-t>"] = "terminal",
                  ["."] = "explorer_focus",
                  ["I"] = "toggle_ignored",
                  ["H"] = "toggle_hidden",
                  ["Z"] = "explorer_close_all",
                  ["]g"] = "explorer_git_next",
                  ["[g"] = "explorer_git_prev",
                  ["]d"] = "explorer_diagnostic_next",
                  ["[d"] = "explorer_diagnostic_prev",
                  ["]w"] = "explorer_warn_next",
                  ["[w"] = "explorer_warn_prev",
                  ["]e"] = "explorer_error_next",
                  ["[e"] = "explorer_error_prev",
                },
              },
            },
          },
        },
      },

      -- terminal = {},

      scroll = {
        animate = {
          duration = { step = 12, total = 175 },
          easing = "linear",
        },
        animate_repeat = {
          delay = 100, -- delay in ms before using the repeat animation
          duration = { step = 5, total = 100 },
          easing = "outQuad",
        },
      },

      dim = {
        scope = {
          min_size = 5,
          max_size = 20,
          siblings = true,
        },
        animate = {
          -- enabled = vim.fn.has("nvim-0.10") == 1,
          enabled = true,
          easing = "outQuad",
          duration = {
            step = 10, -- ms per step
            total = 200, -- maximum duration
          },
        },
        -- what buffers to dim
        filter = function(buf)
          return vim.g.snacks_dim ~= false and vim.b[buf].snacks_dim ~= false and vim.bo[buf].buftype == ""
        end,
      },

      indent = {
        indent = {
          enabled = true,
          char = "┊",
        },
        chunk = {
          enabled = true,
          -- only show chunk scopes in the current window
          only_current = false,
          priority = 200,
          hl = "Function", ---@type string|string[] hl group for chunk scopes
          char = {
            -- corner_top = "┌",
            -- corner_bottom = "└",
            -- -- corner_top = "╭",
            -- -- corner_bottom = "╰",
            -- horizontal = "─",
            -- vertical = "│",
            -- arrow = ">",
            corner_top = "╭",
            corner_bottom = "╰",
            horizontal = " ",
            vertical = "┊",
            arrow = " ",
          },
        },
        animate = {
          enabled = false,
        },
        scope = {
          enabled = true,
          priority = 200,

          -- • left aligned solid
          --   • `▏`
          --   • `▎` (default)
          --   • `▍`
          -- • center aligned solid
          --   • `│`
          --   • `┃`
          -- • right aligned solid
          --   • `▕`
          --   • `▐`
          -- • center aligned dashed
          --   • `╎`
          --   • `╏`
          --   • `┆`
          --   • `┇`
          --   • `┊`
          --   • `┋`
          -- • center aligned double
          --   • `║`

          -- char = "│",
          char = "┊",
          underline = false,
          only_current = false,
          -- hl = "SnacksIndentScope",
          -- hl = "Special",
          -- hl = "Function",
          -- hl = "CursorLineNr",
        },
      },
    },
  },
}
