return {
  {
    "echasnovski/mini.icons",
    version = false,
    config = function()
      require("mini.icons").setup()
    end,
  },
  {
    "echasnovski/mini.files",
    version = false,
    config = function()
      require("mini.files").setup({
        options = {
          use_as_default_explorer = false,
        },
        mappings = {
          go_in_plus = "e",
        },
        windows = {
          preview = false,
          -- Width of focused window
          width_focus = 35,
          -- Width of non-focused window
          width_nofocus = 35,
          -- Width of preview window
          width_preview = 35,
        },
      })
      vim.api.nvim_create_autocmd("User", {
        pattern = "MiniFilesWindowUpdate",
        command = [[set relativenumber]],
      })
      vim.api.nvim_create_autocmd("User", {
        pattern = "MiniFilesWindowOpen",
        command = [[set relativenumber]],
      })
    end,
  },
}
