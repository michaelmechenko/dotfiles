return {
  {
    "rebelot/kanagawa.nvim",
    config = function()
      require("kanagawa").setup({
        compile = false,
        undercurl = true,
        commentStyle = { italic = true },
        functionStyle = { bold = true },
        keywordStyle = { italic = true },
        statementStyle = { bold = true },
        typeStyle = {},
        transparent = true,
        dimInactive = false,
        terminalColors = true,
        colors = {
          palette = {
            -- normal
            -- 938AA9
            -- 957FB8
            -- 8f80b2
            crystalBlue = "#8F80B2",
            -- insert
            -- springGreen = "#76946A",
            -- visual
            -- 8092b2
            -- 9cabca
            oniViolet = "#8092B2",
            -- replace
            -- surimiOrange = "#cf8c8e",
            -- comments
            -- fujiGray = "#63637b",
          },
          theme = {
            wave = {},
            lotus = {},
            dragon = {},
            all = {
              ui = {
                bg_gutter = "none",
              },
            },
          },
        },
        overrides = function(colors)
          local theme = colors.theme

          return {
            LineNr = { fg = "#57576b" },
            LineNrAbove = { fg = "#57576b" },
            LineNrBelow = { fg = "#57576b" },
            CursorLineNr = { fg = "#938AA9", bold = true },
            -- CursorLineNr = { bold = true },
            NonText = { fg = theme.ui.bg_p1, bg = "none" },

            NormalFloat = { bg = "none" },
            FloatBorder = { bg = "none" },
            FloatTitle = { bg = "none" },

            -- Save an hlgroup with dark background and dimmed foreground
            -- so that you can use it where your still want darker windows.
            -- E.g.: autocmd TermOpen * setlocal winhighlight=Normal:NormalDark
            NormalDark = { fg = theme.ui.fg_dim, bg = theme.ui.bg_m3 },

            -- Popular plugins that open floats will link to NormalFloat by default;
            -- set their background accordingly if you wish to keep them dark and borderless
            LazyNormal = { bg = theme.ui.bg_m3, fg = theme.ui.fg_dim },
            MasonNormal = { bg = theme.ui.bg_m3, fg = theme.ui.fg_dim },

            TelescopeTitle = { fg = theme.ui.special, bold = true },
            TelescopePromptNormal = { bg = theme.ui.bg_p1 },
            TelescopePromptBorder = { fg = theme.ui.bg_p1, bg = theme.ui.bg_p1 },
            TelescopeResultsNormal = { fg = theme.ui.fg_dim, bg = theme.ui.bg_m1 },
            TelescopeResultsBorder = { fg = theme.ui.bg_m1, bg = theme.ui.bg_m1 },
            TelescopePreviewNormal = { bg = theme.ui.bg_dim },
            TelescopePreviewBorder = { bg = theme.ui.bg_dim, fg = theme.ui.bg_dim },

            MiniFilesTitleFocused = { fg = "#938AA9", bg = "none" },
            MiniFilesTitle = { fg = "#57576b", bg = "none" },
            -- MiniFilesTitleFocused = { fg = "#938AA9", bg = theme.ui.bg_p1 },
            -- MiniFilesTitle = { fg = "#57576b", bg = theme.ui.bg_p1 },

            Pmenu = { fg = theme.ui.shade0, bg = theme.ui.bg_p1 },
            PmenuSel = { fg = "NONE", bg = theme.ui.bg_p2 },
            PmenuSbar = { bg = theme.ui.bg_m1 },
            PmenuThumb = { bg = theme.ui.bg_p2 },
            Visual = { bg = "#54546D" },
          }
        end,
        theme = "wave", -- Load "wave" theme when 'background' option is not set
        background = { -- map the value of 'background' option to a theme
          dark = "wave", -- try "dragon" !
          -- dark = "dragon", -- try "dragon" !
          light = "lotus",
        },
      })

      -- vim.cmd("colorscheme kanagawa")
    end,
  },
}
