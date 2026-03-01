return {
  {
    "nvim-treesitter/nvim-treesitter",
    build = ":TSUpdate",
    config = function()
      local configs = require("nvim-treesitter.configs")

      configs.setup({
        ensure_installed = {
          "c",
          "lua",
          "vim",
          "vimdoc",
          "javascript",
          "html",
          "css",
          "cmake",
          "csv",
          "cpp",
          "git_config",
          "git_rebase",
          "gitcommit",
          "gitignore",
          "gitattributes",
          "go",
          "http",
          "java",
          "make",
          "python",
          "regex",
          "rust",
          "sql",
          "ssh_config",
          "svelte",
          "tsx",
          "typescript",
          "markdown",
          "latex",
          "xml",
          "yaml",
        },
        auto_install = true,
        sync_install = true,
        highlight = { enable = true },
        indent = { enable = true },
      })
    end,
  },
  {
    "nvim-treesitter/nvim-treesitter-textobjects",
    branch = "main",
    init = function()
      -- Disable entire built-in ftplugin mappings to avoid conflicts.
      -- See https://github.com/neovim/neovim/tree/master/runtime/ftplugin for built-in ftplugins.
      vim.g.no_plugin_maps = true

      -- Or, disable per filetype (add as you like)
      -- vim.g.no_python_maps = true
      -- vim.g.no_ruby_maps = true
      -- vim.g.no_rust_maps = true
      -- vim.g.no_go_maps = true
    end,
    config = function()
      require("nvim-treesitter-textobjects").setup {
        move = {
          -- whether to set jumps in the jumplist
          set_jumps = true,
        },
      }
    end,
  }
}
