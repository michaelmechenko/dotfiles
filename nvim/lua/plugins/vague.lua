return {
  "vague-theme/vague.nvim",
  lazy = false,    -- make sure we load this during startup if it is your main colorscheme
  priority = 1000, -- make sure to load this before all the other plugins
  config = function()
    local palette = require("palette")
    local accent_tertiary = palette["accent-tertiary"] or accent_tertiary
    local accent_secondary = palette["accent-secondary"] or accent_secondary
    local accent_amber = palette["accent-amber"] or accent_amber
    local accent_primary = palette["accent-primary"] or accent_primary
    local accent_info = palette["accent-info"] or accent_info
    local accent_periwinkle = palette["accent-periwinkle"] or accent_periwinkle
    local divider_subtle = palette["divider-subtle"] or divider_subtle
    local surface_highlight = palette["surface-highlight"] or surface_highlight
    local surface_h1 = palette["surface-heading-h1"] or surface_h1
    local surface_h2 = palette["surface-heading-h2"] or surface_h2
    local surface_h3 = palette["surface-heading-h3"] or surface_h3
    local text_muted = palette["text-muted"] or text_muted
    local copy_indicator = palette["copy-mode-indicator"] or copy_indicator
    local text = palette["text"] or "text"
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
        hl["@markup.heading.markdown"]   = { fg = accent_tertiary, bg = "None" }
        hl["@markup.heading.1.markdown"] = { fg = accent_tertiary, bg = "None" }
        hl["@markup.heading.2.markdown"] = { fg = accent_secondary, bg = "None" }
        hl["@markup.heading.3.markdown"] = { fg = accent_amber, bg = "None" }
        hl["@markup.heading.4.markdown"] = { fg = accent_tertiary, bg = "None" }
        hl["@markup.heading.5.markdown"] = { fg = accent_secondary, bg = "None" }
        hl["@markup.heading.6.markdown"] = { fg = accent_amber, bg = "None" }
        hl["@markup.italic"]             = { fg = accent_amber, italic = true, bg = "None" }
        hl["@markup.strong"]             = { fg = "#c3c3d5", bold = true, bg = "None" }
        hl["SnacksIndent"]               = { fg = divider_subtle }
        hl["NeoTreeIndentMarker"]        = { fg = divider_subtle }
        hl["GitSignsAdd"]                = { fg = accent_tertiary }
        hl["GitSignsDelete"]             = { fg = accent_primary }
        hl["GitSignsChange"]             = { fg = accent_amber }
        hl["DiffAdd"]                    = { bg = "#39323A" }
        hl["DiffDelete"]                 = { bg = "#3F262C" }
        hl["CursorLine"]                 = { bg = surface_highlight }
        hl["FoldColumn"]                 = { fg = accent_info }
        -- hl["NonText"]                    = { fg = accent_primary, bold = true }
        hl["FloatBorder"]                = { fg = text_muted }
        hl["BlinkCmpGhostText"]          = { fg = copy_indicator }
        hl["LspInlayHint"]               = { fg = copy_indicator, italic = true }
        hl["GitSignsCurrentLineBlame"]   = { fg = copy_indicator }
        hl["ComplHint"]                  = { fg = copy_indicator }
        -- Heading contract (see COLORS.md surface-heading-h1/h2/h3):
        --   * Treesitter captures @markup.heading.N.markdown own the heading FOREGROUND
        --     (the vivid icon/text color). They are set above (pink/lavender/amber cycle).
        --   * render-markdown's defaults already link RenderMarkdownH1..H6 to those
        --     captures (core/colors.lua, default = true). We deliberately do NOT override
        --     RenderMarkdownH1..H6 here — leaving them unset lets the plugin's links win and
        --     keeps rendered icons in sync with raw syntax, instead of the old shifted
        --     amber/pink/lavender sequence that diverged from Treesitter.
        --   * The *Bg groups own only the decorative heading FILL surface. render-markdown
        --     derives the heading background AND the underline/border fg (via bg_as_fg,
        --     since render-md.lua sets border = true, border_prefix = true) from this bg,
        --     so we set bg only and leave fg unset. Old override set fg + bg = "None",
        --     which made bg_as_fg return invisible and silently dropped the documented
        --     surface-heading backgrounds.
        hl["RenderMarkdownH1Bg"]         = { bg = surface_h1 }
        hl["RenderMarkdownH2Bg"]         = { bg = surface_h2 }
        hl["RenderMarkdownH3Bg"]         = { bg = surface_h3 }
        hl["RenderMarkdownH4Bg"]         = { bg = surface_h1 }
        hl["RenderMarkdownH5Bg"]         = { bg = surface_h2 }
        hl["RenderMarkdownH6Bg"]         = { bg = surface_h3 }
        -- inline `code`: periwinkle fg, no background; fenced blocks keep their bg
        hl["RenderMarkdownCodeInline"]   = { fg = accent_periwinkle, bg = "None" }
        -- table borders: periwinkle (Head default-links to @markup.heading = blue keyword)
        hl["RenderMarkdownTableHead"]    = { fg = accent_periwinkle }
        hl["RenderMarkdownTableRow"]     = { fg = accent_periwinkle }
      end,

      -- Override colors
      colors = {
        -- bg = "#141415",
        -- inactiveBg = "#1c1c24",
        fg = text,
        -- floatBorder = "#878787",
        -- line = "#252530",
        -- comment = copy_indicator,
        -- builtin = "#b4d4cf",
        -- func = "#c48282",
        -- string = "#e8b589",
        -- number = "#e0a363",
        -- property = "#c3c3d5",
        -- constant = accent_secondary,
        -- parameter = accent_tertiary,
        -- visual = "#333738",
        -- error = accent_primary,
        -- warning = accent_amber,
        -- hint = "#7e98e8",
        -- operator = "#90a0b5",
        -- keyword = "#6e94b2",
        -- type = "#9bb4bc",
        -- search = "#405065",
        -- plus = "#7fa563",
        -- delta = accent_amber,
      },
    })
    vim.cmd("colorscheme vague")
  end
}
