return {
  {
    "nvim-treesitter/nvim-treesitter",
    branch = "main",
    build = ":TSUpdate",
    main = "nvim-treesitter",
    init = function()
      local ensure_installed = {
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
      }
      local installed = require("nvim-treesitter.config").get_installed()
      local missing = vim.iter(ensure_installed)
        :filter(function(p) return not vim.tbl_contains(installed, p) end)
        :totable()
      if #missing > 0 then
        require("nvim-treesitter").install(missing)
      end

      -- Enable treesitter highlight and indent for all filetypes
      vim.api.nvim_create_autocmd("FileType", {
        callback = function()
          pcall(vim.treesitter.start)
          vim.bo.indentexpr = "v:lua.require'nvim-treesitter'.indentexpr()"
        end,
      })
    end,
  },
  {
    "nvim-treesitter/nvim-treesitter-textobjects",
    branch = "main",
    init = function()
      vim.g.no_plugin_maps = true
    end,
    config = function()
      require("nvim-treesitter-textobjects").setup {
        move = {
          set_jumps = true,
        },
      }
    end,
  }
}
