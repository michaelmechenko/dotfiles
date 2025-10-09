return {
  "lewis6991/hover.nvim",
  opts = function()
    require('hover').config({
      providers = {
        'hover.providers.diagnostic',
        'hover.providers.lsp',
        'hover.providers.dap',
        'hover.providers.man',
        'hover.providers.fold_preview',
        'hover.providers.highlight',
        -- 'hover.providers.dictionary',
        'hover.providers.gh',
        -- 'hover.providers.gh_user',
        -- 'hover.providers.jira',
      },
      preview_opts = {
        border = "single",
      },
      -- Whether the contents of a currently open hover window should be moved
      -- to a :h preview-window when pressing the hover keymap.
      preview_window = false,
      title = true,
    })
  end,
  config = function()
    vim.keymap.set("n", "K", require("hover").hover, { desc = "hover" })

    vim.keymap.set('n', '<leader>k',
      function()
        require('hover').enter()
      end, { desc = 'hover (enter)' })
  end,
}
