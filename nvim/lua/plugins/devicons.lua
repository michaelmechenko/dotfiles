return {
  "nvim-tree/nvim-web-devicons",
  config = function(_, opts)
    require("nvim-web-devicons").setup(opts)

    -- Override all DevIcon* highlights to single color globally
    local function override_devicon_colors()
      local color = "#656a80"
      local highlights = vim.api.nvim_get_hl(0, {})

      for name, _ in pairs(highlights) do
        if name:match("^DevIcon") then
          vim.api.nvim_set_hl(0, name, { fg = color })
        end
      end
    end

    -- Apply immediately
    override_devicon_colors()

    -- Re-apply after colorscheme changes
    vim.api.nvim_create_autocmd("ColorScheme", {
      group = vim.api.nvim_create_augroup("DevIconColorOverride", { clear = true }),
      callback = override_devicon_colors,
    })

    -- Also re-apply after delay to ensure it wins
    vim.defer_fn(override_devicon_colors, 100)
  end,
}
