return {
  {
    "akinsho/toggleterm.nvim",
    version = "*",
    config = function()
      require("toggleterm").setup({
        open_mapping = [[<C-,>]], -- or { [[<c-\>]], [[<c-¥>]] } if you also use a Japanese keyboard.
        shade_filetypes = {},
        autochdir = false,    -- when neovim changes it current directory the terminal will change it's own when next it's opened
        shade_terminals = false, -- NOTE: this option takes priority over highlights specified so if you specify Normal highlights you should set this to false
        -- shading_factor = "<number>", -- the percentage by which to lighten dark terminal background, default: -30
        -- shading_ratio = "<number>", -- the ratio of shading factor for light/dark terminal background, default: -3
        start_in_insert = true,
        insert_mappings = true, -- whether or not the open mapping applies in insert mode
        terminal_mappings = true, -- whether or not the open mapping applies in the opened terminals
        -- persist_size = true,
        -- persist_mode = true, -- if set to true (default) the previous terminal mode will be remembered
        direction = "float",
        -- "vertical" | "horizontal" | "tab" | "float"
        close_on_exit = false, -- close the terminal window when the process exits
        -- Change the default shell. Can be a string or a function returning a string
        shell = vim.o.shell,
        auto_scroll = false, -- automatically scroll to the bottom on terminal output
        highlights = {
          -- highlights which map to a highlight group name and a table of it's values
          -- NOTE: this is only a subset of values, any group placed here will be set for the terminal window split
          Normal = {},
          NormalFloat = {},
          FloatBorder = {},
        },
      })
    end,
  },
}
