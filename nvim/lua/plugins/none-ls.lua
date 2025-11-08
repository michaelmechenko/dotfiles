return {
  "nvimtools/none-ls.nvim",
  dependencies = {
    "nvimtools/none-ls-extras.nvim",
  },
  config = function()
    local null_ls = require("null-ls")

    null_ls.setup({
      sources = {
        -- formatting
        -- null_ls.builtins.formatting.asmfmt,
        -- null_ls.builtins.formatting.latexindent,
        -- null_ls.builtins.formatting.stylua,
        -- null_ls.builtins.formatting.prettier,
        null_ls.builtins.formatting.clang_format,
        null_ls.builtins.formatting.biome,
        null_ls.builtins.formatting.shfmt,

        -- diagnostics
        -- null_ls.builtins.diagnostics.markdownlint,
        -- null_ls.builtins.diagnostics.cppcheck,
        -- null_ls.builtins.diagnostics.cpplint,

        -- code actions
        null_ls.builtins.code_actions.refactoring,
        null_ls.builtins.code_actions.gitsigns,
        null_ls.builtins.code_actions.impl,

        -- completions
        null_ls.builtins.completion.luasnip,

        -- linters
        -- null_ls.builtins.diagnostics.yamllint,
        null_ls.builtins.diagnostics.zsh,

        -- hover
        null_ls.builtins.hover.printenv
      },
    })
  end,
}
