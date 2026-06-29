return {
  "vague-theme/vague.nvim",
  lazy = false,    -- make sure we load this during startup if it is your main colorscheme
  priority = 1000, -- make sure to load this before all the other plugins
  config = function()
    require("vague").setup({
      transparent = true,
      bold = true,
      italic = true,
      style = {
        -- "none" is the same thing as default. But "italic" and "bold" are also valid options
        boolean = "none",
        number = "none",
        float = "none",
        error = "bold",
        comments = "italic",
        conditionals = "none",
        functions = "none",
        headings = "none",
        operators = "none",
        strings = "none",
        variables = "none",

        -- keywords
        keywords = "none",
        keyword_return = "italic",
        keywords_loop = "none",
        keywords_label = "none",
        keywords_exception = "none",

        -- builtin
        builtin_constants = "none",
        builtin_functions = "none",
        builtin_types = "none",
        builtin_variables = "none",
      },
      -- plugin styles where applicable
      -- make an issue/pr if you'd like to see more styling options!
      -- plugins = {
      --   cmp = {
      --     match = "bold",
      --     match_fuzzy = "bold",
      --   },
      --   dashboard = {
      --     footer = "italic",
      --   },
      --   lsp = {
      --     diagnostic_error = "bold",
      --     diagnostic_hint = "none",
      --     diagnostic_info = "italic",
      --     diagnostic_ok = "none",
      --     diagnostic_warn = "bold",
      --   },
      --   neotest = {
      --     focused = "bold",
      --     adapter_name = "bold",
      --   },
      --   telescope = {
      --     match = "bold",
      --   },
      -- },

      -- Override highlights or add new highlights
      on_highlights = function(hl, c)
        -- hl["NormalFloat"].bg             = "#1C1C24"
        -- hl["Pmenu"].bg                   = "#1C1C24"
        -- hl["Special"]                    = hl["@lsp.type.selfParameter"]
        -- hl["Typedef"]                    = hl["@lsp.type.typeParameter"]
        -- hl["Structure"]                  = hl["@lsp.type.enum"]
        -- hl["Macro"]                      = hl["@lsp.type.macro"]
        -- hl["Comment"]                    = hl["@lsp.type.comment"]
        -- hl["@constant.builtin"]          = hl["@lsp.type.builtinConstant"]
        -- hl["@type.builtin"]              = hl["@lsp.type.builtinType"]
        -- hl["@variable.member"]           = hl["@lsp.type.enumMember"]
        -- hl["@function.call"]             = hl["@lsp.type.function"]
        -- hl["@function.method"]           = hl["@lsp.type.method"]
        -- hl["@type"]                      = hl["@lsp.type.builtinType"]
        -- hl["@module"]                    = hl["@lsp.type.namespace"]
        -- hl["@constant"]                  = hl["@lsp.type.variable"]
        -- hl["@function.builtin"]          = hl["@lsp.type.function"]
        -- hl["@variable"]                  = hl["@lsp.type.variable"]
        -- hl["@variable.parameter"]        = hl["@lsp.type.parameter"]
        -- hl["@property"]                  = hl["@lsp.type.property"]
        hl["@markup.heading.markdown"]   = { fg = "#bb9dbd", bg = "None" }
        hl["@markup.heading.1.markdown"] = { fg = "#bb9dbd", bg = "None" }
        hl["@markup.heading.2.markdown"] = { fg = "#aeaed1", bg = "None" }
        hl["@markup.heading.3.markdown"] = { fg = "#f3be7c", bg = "None" }
        hl["@markup.heading.4.markdown"] = { fg = "#bb9dbd", bg = "None" }
        hl["@markup.heading.5.markdown"] = { fg = "#aeaed1", bg = "None" }
        hl["@markup.heading.6.markdown"] = { fg = "#f3be7c", bg = "None" }
        hl["@markup.italic"]             = { fg = "#f3be7c", italic = true, bg = "None" }
        hl["@markup.strong"]             = { fg = "#c3c3d5", bold = true, bg = "None" }
        hl["SnacksIndent"]               = { fg = "#383848" }
        hl["NeoTreeIndentMarker"]        = { fg = "#383848" }
        hl["GitSignsAdd"]                = { fg = "#bb9dbd" }
        hl["GitSignsDelete"]             = { fg = "#d8647e" }
        hl["GitSignsChange"]             = { fg = "#f3be7c" }
        hl["DiffAdd"]                    = { bg = "#39323A" }
        hl["DiffDelete"]                 = { bg = "#3F262C" }
        hl["CursorLine"]                 = { bg = "#2A2A35" }
        hl["FoldColumn"]                 = { fg = "#8ba9c1" }
        -- hl["NonText"]                    = { fg = "#d8647e", bold = true }
        hl["FloatBorder"]                = { fg = "#656a80" }
        hl["BlinkCmpGhostText"]          = { fg = "#606079" }
        hl["LspInlayHint"]               = { fg = "#606079", italic = true }
        hl["GitSignsCurrentLineBlame"]   = { fg = "#606079" }
        hl["ComplHint"]                  = { fg = "#606079" }
        hl["RenderMarkdownH1Bg"]         = { bg = "#352f37" }
        hl["RenderMarkdownH2Bg"]         = { bg = "#33333a" }
        hl["RenderMarkdownH3Bg"]         = { bg = "#40362a" }
        hl["RenderMarkdownH4Bg"]         = { bg = "#352f37" }
        hl["RenderMarkdownH5Bg"]         = { bg = "#33333a" }
        hl["RenderMarkdownH6Bg"]         = { bg = "#40362a" }
        -- inline `code`: periwinkle fg, no background; fenced blocks keep their bg
        hl["RenderMarkdownCodeInline"]   = { fg = "#9b9bcc", bg = "None" }
        -- table borders: periwinkle (Head default-links to @markup.heading = blue keyword)
        hl["RenderMarkdownTableHead"]    = { fg = "#9b9bcc" }
        hl["RenderMarkdownTableRow"]     = { fg = "#9b9bcc" }
      end,

      -- Override colors
      colors = {
        -- bg = "#141415",
        -- inactiveBg = "#1c1c24",
        fg = "#BEBEBE",
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
