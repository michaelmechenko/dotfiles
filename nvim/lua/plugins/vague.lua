return {
  "vague-theme/vague.nvim",
  lazy = false,    -- make sure we load this during startup if it is your main colorscheme
  priority = 1001, -- make sure to load this before all the other plugins
  config = function()
    require("vague").setup({
      transparent = true, -- don't set background
      -- disable bold/italic globally in `style`
      bold = false,
      italic = true,
      style = {
        -- "none" is the same thing as default. But "italic" and "bold" are also valid options
        boolean = "bold",
        number = "none",
        float = "none",
        error = "bold",
        comments = "italic",
        conditionals = "none",
        functions = "none",
        headings = "bold",
        operators = "none",
        strings = "italic",
        variables = "none",

        -- keywords
        keywords = "none",
        keyword_return = "italic",
        keywords_loop = "none",
        keywords_label = "none",
        keywords_exception = "none",

        -- builtin
        builtin_constants = "bold",
        builtin_functions = "none",
        builtin_types = "bold",
        builtin_variables = "none",
      },
      -- plugin styles where applicable
      -- make an issue/pr if you'd like to see more styling options!
      plugins = {
        cmp = {
          match = "bold",
          match_fuzzy = "bold",
        },
        dashboard = {
          footer = "italic",
        },
        lsp = {
          diagnostic_error = "bold",
          diagnostic_hint = "none",
          diagnostic_info = "italic",
          diagnostic_ok = "none",
          diagnostic_warn = "bold",
        },
        neotest = {
          focused = "bold",
          adapter_name = "bold",
        },
        telescope = {
          match = "bold",
        },
      },

    })
    vim.cmd("colorscheme vague")
  end
}
