return {
  "lewis6991/hover.nvim",
  lazy = false,
  config = function()
    require('hover').setup({
      providers = {
        'hover.providers.diagnostic',
        -- 'hover.providers.lsp',
        -- 'hover.providers.dap',
        -- 'hover.providers.man',
        'hover.providers.fold_preview',
        'hover.providers.highlight',
        -- 'hover.providers.dictionary',
        'hover.providers.gh',
        -- 'hover.providers.gh_user',
        -- 'hover.providers.jira',
      },
      preview_window = false,
      title = true,
    })
    vim.keymap.set("n", "<leader>k", require("hover").hover, { desc = "hover" })

    vim.keymap.set('n', '<leader>K',
      function()
        require('hover').enter()
      end, { desc = 'hover (enter)' })
  end,
}
