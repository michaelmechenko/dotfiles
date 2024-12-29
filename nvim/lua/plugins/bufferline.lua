return {
  {
    "akinsho/bufferline.nvim",
    version = "*",
    dependencies = "nvim-tree/nvim-web-devicons",
    config = function()
      require("bufferline").setup({
        options = {
          numbers = function(opts)
            return string.format("%s", opts.ordinal)
          end,
          style_preset = {
            require("bufferline").style_preset.no_italic,
            require("bufferline").style_preset.no_bold,
          },
          color_icons = false,
        },
      })
    end,
  },
}
