return {
  {
    "williamboman/mason.nvim",
    config = function()
      require("mason").setup()
    end,
  },
  {
    "williamboman/mason-lspconfig.nvim",
    config = function()
      require("mason-lspconfig").setup({
        ensure_installed = {
          "lua_ls",
          "rust_analyzer",
          "typos_lsp",
          "arduino_language_server",
          "clangd",
          "cmake",
          "cssls",
          "dockerls",
          "eslint",
          "gopls",
          "html",
          "biome",
          "java_language_server",
          "markdown_oxide",
          "pyright",
          "svelte",
          "tailwindcss",
          "lemminx",
          "tsserver",
        },
      })
    end,
  },
  {
    "neovim/nvim-lspconfig",
    config = function()
      local lspconfig = require("lspconfig")
      lspconfig.tsserver.setup({})
      lspconfig.lua_ls.setup({})
      lspconfig.rust_analyzer.setup({})
      lspconfig.typos_lsp.setup({})
      lspconfig.arduino_language_server.setup({})
      lspconfig.clangd.setup({})
      lspconfig.cmake.setup({})
      lspconfig.cssls.setup({})
      lspconfig.dockerls.setup({})
      lspconfig.eslint.setup({})
      lspconfig.gopls.setup({})
      lspconfig.html.setup({})
      lspconfig.biome.setup({})
      lspconfig.java_language_server.setup({})
      lspconfig.markdown_oxide.setup({})
      lspconfig.pyright.setup({})
      lspconfig.svelte.setup({})
      lspconfig.tailwindcss.setup({})
      lspconfig.lemminx.setup({})

      vim.keymap.set("n", "<leader>ll", vim.lsp.buf.hover, {})
      vim.keymap.set("n", "<leader>lk", vim.lsp.buf.definition, {})
      vim.keymap.set("n", "<leader>lm", vim.lsp.buf.code_action, {})
    end,
  },
}
