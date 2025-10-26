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

      -- explorer = {},

      dashboard = {
        width = 60,
        row = nil,    -- dashboard position. nil for center
        col = nil,    -- dashboard position. nil for center
        pane_gap = 4, -- empty columns between vertical panes
        formats = {
          key = function(item)
            return { { "[", hl = "key" }, { item.key, hl = "key" }, { "]", hl = "key" } }
          end,
        },
        preset = {
          pick = nil,
          keys = {
            { icon = "-", key = "n",  desc = "new file", action = ":ene | startinsert" },
            { icon = "-", key = "re", desc = "filetree", action = "<cmd>Neotree filesystem right<CR>" },
            {
              icon = "-",
              key = "fe",
              desc = "find files",
              action = function()
                require("snacks").picker.files()
              end
            },
            {
              icon = "-",
              key = "fg",
              desc = "live grep",
              action = function()
                require("snacks").picker.grep()
              end
            },
            {
              icon = "-",
              key = "fr",
              desc = "recent files",
              action = function()
                require("snacks").picker.recent()
              end
            },
            { icon = "-", key = "c", desc = "config",  action = ":lua Snacks.dashboard.pick('files', {cwd = vim.fn.stdpath('config')})" },
            { icon = "-", key = "l", desc = "lazy",    action = ":Lazy",                                                                enabled = package.loaded.lazy ~= nil },
            { icon = "-", key = "m", desc = "mason",   action = ":Mason",                                                               enabled = package.loaded.lazy ~= nil },
            { icon = "-", key = "M", desc = "mcp hub", action = ":MCPHub",                                                              enabled = package.loaded.lazy ~= nil },
            { icon = "-", key = "q", desc = "quit",    action = ":qa" },
          },
          header = [[notepad--]],
        },
        sections = {
          { section = "header",       padding = 2 },
          { section = "keys",         gap = 1,    indent = 0, padding = 1 },
          { title = "recents",        padding = 1 },
          { section = "recent_files", indent = 2, limit = 5,  padding = 1 },
          { title = "recents [cwd]",  padding = 1 },
          { section = "recent_files", cwd = true, indent = 2, limit = 5,  padding = 1 },
        },
      },

      picker = {
        win = {
          input = {
            keys = {
              -- to close the picker on ESC instead of going to normal mode,
              -- add the following keymap to your config
              -- ["<Esc>"] = { "close", mode = { "n", "i" } },
              ["/"] = "toggle_focus",
              ["<C-Down>"] = { "history_forward", mode = { "i", "n" } },
              ["<C-Up>"] = { "history_back", mode = { "i", "n" } },
              ["<C-c>"] = { "cancel", mode = "i" },
              ["<C-w>"] = { "<c-s-w>", mode = { "i" }, expr = true, desc = "delete word" },
              ["<CR>"] = { "confirm", mode = { "n", "i" } },
              ["<Down>"] = { "list_down", mode = { "i", "n" } },
              ["<Esc>"] = "cancel",
              -- ["<c-s>"] = { { "pick_win", "jump" }, mode = { "n", "i" } },
              ["<c-e>"] = { "select_and_next", mode = { "i", "n" } },
              ["<S-Tab>"] = { "list_up", mode = { "i", "n" } },
              ["<Tab>"] = { "list_down", mode = { "i", "n" } },
              -- ["<S-Tab>"] = { "select_and_prev", mode = { "i", "n" } },
              -- ["<Tab>"] = { "select_and_next", mode = { "i", "n" } },
              ["<Up>"] = { "list_up", mode = { "i", "n" } },
              ["<a-d>"] = { "inspect", mode = { "n", "i" } },
              ["<a-f>"] = { "toggle_follow", mode = { "i", "n" } },
              ["<c-h>"] = { "toggle_hidden", mode = { "i", "n" } },
              ["<c-i>"] = { "toggle_ignored", mode = { "i", "n" } },
              ["<c-m>"] = { "toggle_maximize", mode = { "i", "n" } },
              ["<c-p>"] = { "toggle_preview", mode = { "i", "n" } },
              ["<c-w>"] = { "cycle_win", mode = { "i", "n" } },
              ["<c-a>"] = { "select_all", mode = { "n", "i" } },
              ["<c-b>"] = { "preview_scroll_up", mode = { "i", "n" } },
              ["<c-d>"] = { "list_scroll_down", mode = { "i", "n" } },
              ["<c-f>"] = { "preview_scroll_down", mode = { "i", "n" } },
              ["<c-g>"] = { "toggle_live", mode = { "i", "n" } },
              -- ["<c-j>"] = { "list_down", mode = { "i", "n" } },
              -- ["<c-k>"] = { "list_up", mode = { "i", "n" } },
              -- ["<c-n>"] = { "list_down", mode = { "i", "n" } },
              -- ["<c-p>"] = { "list_up", mode = { "i", "n" } },
              ["<c-q>"] = { "qflist", mode = { "i", "n" } },
              -- ["<c-s>"] = { "edit_split", mode = { "i", "n" } },
              ["<c-t>"] = { "tab", mode = { "n", "i" } },
              ["<c-u>"] = { "list_scroll_up", mode = { "i", "n" } },
              ["<c-v>"] = { "edit_vsplit", mode = { "i", "n" } },
              -- ["<c-w>H"] = "layout_left",
              -- ["<c-w>J"] = "layout_bottom",
              -- ["<c-w>K"] = "layout_top",
              -- ["<c-w>L"] = "layout_right",
              ["?"] = "toggle_help_input",
              ["G"] = "list_bottom",
              ["gg"] = "list_top",
              ["j"] = "list_down",
              ["k"] = "list_up",
              ["q"] = "close",
            },
          },
        },
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
            auto_close = true,
            jump = { close = true },
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

      -- scroll = {
      -- 	animate = {
      -- 		duration = { step = 15, total = 200 },
      -- 		easing = "linear",
      -- 	},
      -- 	animate_repeat = {
      -- 		delay = 100, -- delay in ms before using the repeat animation
      -- 		duration = { step = 6, total = 60 },
      -- 		easing = "outQuad",
      -- 	},
      -- },

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
            step = 10,   -- ms per step
            total = 200, -- maximum duration
          },
        },
        -- what buffers to dim
        filter = function(buf)
          return vim.g.snacks_dim ~= false and vim.b[buf].snacks_dim ~= false and vim.bo[buf].buftype == ""
        end,
      },

      scope = {
        enabled = true,
      },

      indent = {
        indent = {
          enabled = true,
          char = "┊",
        },
        chunk = {
          enabled = false,
          -- only show chunk scopes in the current window
          only_current = true,
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
          only_current = true,
          -- hl = "SnacksIndentScope",
          -- hl = "Special",
          -- hl = "Function",
          -- hl = "CursorLineNr",
        },
      },
      statuscolumn = {
        left = { "mark", "sign" }, -- priority of signs on the left (high to low)
        right = { "fold", "git" }, -- priority of signs on the right (high to low)
        folds = {
          open = false,            -- show open fold icons
          git_hl = false,          -- use Git Signs hl for fold icons
        },
        git = {
          -- patterns to match Git signs
          patterns = { "GitSign", "MiniDiffSign" },
        },
        refresh = 50, -- refresh at most every 50ms
      }
    },
  },
}
