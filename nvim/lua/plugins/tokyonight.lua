return {
  {
    "folke/tokyonight.nvim",
    lazy = false,
    priority = 1000,
    config = function()
      require("tokyonight").setup({
        style = "night",        -- The theme comes in three styles, `storm`, a darker variant `night` and `day`
        light_style = "day",    -- The theme is used when the background is set to light
        transparent = true,     -- Enable this to disable setting the background color
        terminal_colors = true, -- Configure the colors used when opening a `:terminal` in Neovim
        styles = {
          -- Style to be applied to different syntax groups
          -- Value is any valid attr-list value for `:help nvim_set_hl`
          comments = { italic = true },
          keywords = { italic = true },
          functions = {},
          variables = {},
          -- Background styles. Can be "dark", "transparent" or "normal"
          sidebars = "normal",    -- style for sidebars, see below
          floats = "transparent", -- style for floating windows
        },
        day_brightness = 0.3,     -- Adjusts the brightness of the colors of the **Day** style. Number between 0 and 1, from dull to vibrant colors
        dim_inactive = true,      -- dims inactive windows
        lualine_bold = false,     -- When `true`, section headers in the lualine theme will be bold

        --- You can override specific color groups to use other groups or a hex color
        --- function will be called with a ColorScheme table
        ---@param colors ColorScheme
        on_colors = function(colors)
          colors.bg_statusline = "#161616"
          colors.bg_sidebar = "#161616"
          colors.bg = "#161616"
          colors.bg_dark = "#151515"
          colors.border_highlight = "#BB9AF7"
        end,

        --- You can override specific highlights to use other groups or a hex color
        --- function will be called with a Highlights and ColorScheme table
        ---@param highlights tokyonight.Highlights
        ---@param colors ColorScheme
        on_highlights = function(highlights, colors)
          highlights["@markup.strong"].fg = colors.magenta
          highlights["@markup.italic"].fg = colors.magenta2
          highlights["@markup.raw.markdown_inline"].bg = "None"
        end,

        cache = true, -- When set to true, the theme will be cached for better performance

        ---@type table<string, boolean|{enabled:boolean}>
        plugins = {
          -- enable all plugins when not using lazy.nvim
          -- set to false to manually enable/disable plugins
          all = package.loaded.lazy == nil,
          -- uses your plugin manager to automatically enable needed plugins
          -- currently only lazy.nvim is supported
          auto = true,
          -- add any plugins here that you want to enable
          -- for all possible plugins, see:
          --   * https://github.com/folke/tokyonight.nvim/tree/main/lua/tokyonight/groups
          -- telescope = true,
        },
      })
      vim.cmd([[colorscheme tokyonight]])
    end,
  },
}
