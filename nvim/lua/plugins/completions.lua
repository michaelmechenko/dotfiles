return {
  {
    "L3MON4D3/LuaSnip",
    -- follow latest release.
    version = "v2.*", -- Replace <CurrentMajor> by the latest released major (first number of latest release)
    -- install jsregexp (optional!).
    build = "make install_jsregexp"
  },
  {
    'saghen/blink.cmp',
    dependencies = { 'rafamadriz/friendly-snippets' },
    version = '1.*',

    opts = {
      -- C-k: Toggle signature help (if signature.enabled = true)
      keymap = {
        preset = 'default',
        ['<C-q>'] = { 'hide' },
        ['<C-e>'] = { 'accept' },
        ['<C-o>'] = { 'show_documentation', 'hide_documentation' },
        ['<C-u>'] = { 'scroll_documentation_up' },
        ['<C-d>'] = { 'scroll_documentation_down' },
        ['<C-k>'] = { 'show_signature', 'hide_signature' },
        ['<C-U>'] = { 'scroll_signature_up' },
        ['<C-D>'] = { 'scroll_signature_down' },
        ['<C-w>'] = { 'select_prev' },
        ['<C-s>'] = { 'select_next' },
        ['<Tab>'] = { 'snippet_forward', 'fallback' },
        ['<S-Tab>'] = { 'snippet_backward', 'fallback' },
      },

      appearance = {
        nerd_font_variant = 'normal' -- default = mono
      },

      signature = {
        enabled = true,
        trigger = {
          -- Show the signature help automatically
          enabled = true,
          -- Show the signature help window after typing any of alphanumerics, `-` or `_`
          show_on_keyword = false,
          blocked_trigger_characters = {},
          blocked_retrigger_characters = {},
          -- Show the signature help window after typing a trigger character
          show_on_trigger_character = true,
          -- Show the signature help window when entering insert mode
          show_on_insert = false,
          -- Show the signature help window when the cursor comes after a trigger character when entering insert mode
          show_on_insert_on_trigger_character = true,
        },
        window = {
          border = 'single',
          scrollbar = false,
          treesitter_highlighting = true,
          show_documentation = false,
        },
      },

      completion = {
        menu = {
          -- avoid multi-line completion ghost_text
          direction_priority = function()
            local ctx = require('blink.cmp').get_context()
            local item = require('blink.cmp').get_selected_item()
            if ctx == nil or item == nil then return { 's', 'n' } end

            local item_text = item.textEdit ~= nil and item.textEdit.newText or item.insertText or item.label
            local is_multi_line = item_text:find('\n') ~= nil

            -- after showing the menu upwards, we want to maintain that direction
            -- until we re-open the menu, so store the context id in a global variable
            if is_multi_line or vim.g.blink_cmp_upwards_ctx_id == ctx.id then
              vim.g.blink_cmp_upwards_ctx_id = ctx.id
              return { 'n', 's' }
            end
            return { 's', 'n' }
          end,
          border = 'single',
          draw = {
            align_to = "cursor"
          },
          scrollbar = false,
        },
        documentation = {
          auto_show = true,
          auto_show_delay_ms = 800,
          window = { border = 'single', scrollbar = false, }
        },
        ghost_text = {
          enabled = true
        }
      },

      sources = {
        default = { 'lsp', 'path', 'snippets' },
      },

      fuzzy = { implementation = "prefer_rust_with_warning" }
    },
    opts_extend = { "sources.default" }
  }
}
