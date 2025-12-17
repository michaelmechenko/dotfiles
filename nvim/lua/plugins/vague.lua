return {
  "vague-theme/vague.nvim",
  lazy = false,    -- make sure we load this during startup if it is your main colorscheme
  priority = 1000, -- make sure to load this before all the other plugins
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

      -- Override highlights or add new highlights
      on_highlights = function(hl, c)
        hl["Special"]                    = hl["@lsp.type.selfParameter"]
        hl["Typedef"]                    = hl["@lsp.type.typeParameter"]
        hl["Structure"]                  = hl["@lsp.type.interface"]
        hl["Macro"]                      = hl["@lsp.type.macro"]
        hl["Structure"]                  = hl["@lsp.type.class"]
        hl["Comment"]                    = hl["@lsp.type.comment"]
        hl["Structure"]                  = hl["@lsp.type.enum"]
        hl["@constant.builtin"]          = hl["@lsp.type.builtinConstant"]
        hl["@type.builtin"]              = hl["@lsp.type.builtinType"]
        hl["@variable.member"]           = hl["@lsp.type.enumMember"]
        hl["@function.call"]             = hl["@lsp.type.function"]
        hl["@function.method"]           = hl["@lsp.type.method"]
        hl["@type"]                      = hl["@lsp.type.generic"]
        hl["@module"]                    = hl["@lsp.type.namespace"]
        hl["@type"]                      = hl["@lsp.type.builtinType"]
        hl["@constant"]                  = hl["@lsp.type.variable"]
        hl["@function.builtin"]          = hl["@lsp.type.function"]
        hl["@variable"]                  = hl["@lsp.type.variable"]
        hl["@variable.parameter"]        = hl["@lsp.type.parameter"]
        hl["@property"]                  = hl["@lsp.type.property"]
        hl["@markup.heading.1.markdown"] = { fg = c.func, bg = "None" }
        hl["@markup.heading.2.markdown"] = { fg = c.parameter, bg = "None" }
        hl["@markup.heading.3.markdown"] = { fg = c.constant, bg = "None" }
        hl["@markup.heading.4.markdown"] = { fg = c.property, bg = "None" }
        hl["@markup.heading.5.markdown"] = { fg = c.visual, bg = "None" }
        hl["@markup.heading.6.markdown"] = { fg = c.property, bg = "None" }
      end,

      -- Override colors
      colors = {
        -- bg = "#141415",
        -- inactiveBg = "#1c1c24",
        -- fg = "#cdcdcd",
        -- floatBorder = "#878787",
        -- line = "#252530",
        -- comment = "#606079",
        -- builtin = "#b4d4cf",
        -- func = "#c48282",
        -- string = "#e8b589",
        -- number = "#e0a363",
        -- property = "#c3c3d5",
        -- constant = "#aeaed1",
        -- parameter = "#bb9dbd",
        -- visual = "#333738",
        -- error = "#d8647e",
        -- warning = "#f3be7c",
        -- hint = "#7e98e8",
        -- operator = "#90a0b5",
        -- keyword = "#6e94b2",
        -- type = "#9bb4bc",
        -- search = "#405065",
        -- plus = "#7fa563",
        -- delta = "#f3be7c",
      },
    })
    vim.cmd("colorscheme vague")
  end
}
