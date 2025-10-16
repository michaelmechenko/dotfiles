return {
  {
    "folke/noice.nvim",
    event = "VeryLazy",
    dependencies = {
      -- if you lazy-load any plugin below, make sure to add proper `module="..."` entries
      "MunifTanjim/nui.nvim",
      -- OPTIONAL:
      -- `nvim-notify` is only needed, if you want to use the notification view.
      -- "rcarriga/nvim-notify",
    },
    config = function()
      local noice = require("noice")
      noice.setup({
        cmdline = {
          enabled = true,
          view = "cmdline",
          opts = {},
          format = {
            cmdline = { pattern = "^:", icon = "»", lang = "vim" },
            search_down = { kind = "search", pattern = "^/", icon = " ", lang = "regex" },
            search_up = { kind = "search", pattern = "^%?", icon = " ", lang = "regex" },
            filter = { pattern = "^:%s*!", icon = "$", lang = "bash" },
            lua = {
              pattern = { "^:%s*lua%s+", "^:%s*lua%s*=%s*", "^:%s*=%s*" },
              icon = "",
              lang = "lua",
            },
            help = { pattern = "^:%s*he?l?p?%s+", icon = "?" },
            input = {}, -- Used by input()
            -- lua = false, -- to disable a format, set to `false`
          },
        },
        lsp = {
          override = {
            ["vim.lsp.util.convert_input_to_markdown_lines"] = true,
            ["vim.lsp.util.stylize_markdown"] = true,
          },
          hover = {
            enabled = true,
            silent = true, -- set to true to not show a message if hover is not available
            view = nil,    -- when nil, use defaults from documentation
            ---@type NoiceViewOptions
            opts = {},     -- merged with defaults from documentation
          },
          signature = {
            enabled = true,
            auto_open = {
              enabled = false,
              trigger = false,
              luasnip = false,
              throttle = 50,
            },
            -- view = "hover", -- when nil, use defaults from documentation
            opts = {}, -- merged with defaults from documentation
          },
          message = {
            enabled = true,
            view = "mini",
            opts = {},
          },
          documentation = {
            view = "hover",
            opts = {
              lang = "markdown",
              replace = true,
              render = "plain",
              format = { "{message}" },
              win_options = { concealcursor = "n", conceallevel = 0 },
            },
          },
        },
        presets = {
          lsp_doc_border = true, -- add a border to hover docs and signature help
        },
        messages = {
          enabled = true,        -- enables the Noice messages UI
          view = "mini",         -- default view for messages
          view_error = "mini",   -- view for errors
          view_warn = "mini",    -- view for warnings
          view_history = "mini", -- view for :messages
          view_search = "mini",  -- view for search count messages. Set to `false` to disable
        },
      })
    end,
  },
}
