return {
  {
    "L3MON4D3/LuaSnip",
    version = "v2.*",
    build = "make install_jsregexp",
  },
  {
    "saghen/blink.cmp",
    dependencies = { "rafamadriz/friendly-snippets" },
    version = "1.*",
    opts = {
      keymap = {
        preset = "default",
        ["<C-q>"] = { "hide" },
        ["<C-e>"] = { "accept" },
        ["<C-o>"] = { "show_documentation", "hide_documentation" },
        ["<C-u>"] = { "scroll_documentation_up" },
        ["<C-d>"] = { "scroll_documentation_down" },
        ["<C-k>"] = { "show_signature", "hide_signature" },
        ["<C-w>"] = { "select_prev" },
        ["<C-s>"] = { "select_next" },
        ["<Tab>"] = false,
        ["<S-Tab>"] = false,
      },

      snippets = {
        preset = "luasnip",
      },

      appearance = {
        nerd_font_variant = "mono",
      },

      signature = {
        enabled = true,
        trigger = {
          enabled = true,
          show_on_keyword = false,
          blocked_trigger_characters = {},
          blocked_retrigger_characters = {},
          show_on_trigger_character = true,
          show_on_insert = false,
          show_on_insert_on_trigger_character = true,
        },
        window = {
          scrollbar = false,
          treesitter_highlighting = true,
          show_documentation = false,
        },
      },

      completion = {
        menu = {
          direction_priority = function()
            local ctx = require("blink.cmp").get_context()
            local item = require("blink.cmp").get_selected_item()
            if ctx == nil or item == nil then
              return { "s", "n" }
            end

            local item_text = item.textEdit ~= nil and item.textEdit.newText or item.insertText or item.label
            local is_multi_line = item_text:find("\n") ~= nil

            if is_multi_line or vim.g.blink_cmp_upwards_ctx_id == ctx.id then
              vim.g.blink_cmp_upwards_ctx_id = ctx.id
              return { "n", "s" }
            end
            return { "s", "n" }
          end,
          draw = {
            align_to = "cursor",
          },
          scrollbar = false,
        },
        documentation = {
          auto_show = true,
          auto_show_delay_ms = 800,
          window = { scrollbar = false },
        },
        ghost_text = {
          enabled = true,
          show_with_selection = true,
          show_without_selection = false,
          show_with_menu = true,
          show_without_menu = false,
        },
        list = {
          selection = {
            preselect = true,
            auto_insert = false,
          },
        },
      },

      sources = {
        default = { "lsp", "path", "snippets" },
        providers = {
          path = {
            opts = {
              get_cwd = function(_)
                return vim.fn.getcwd()
              end,
            },
          },
        },
      },

      fuzzy = { implementation = "prefer_rust_with_warning" },
    },
    opts_extend = { "sources.default" },
  },
}
