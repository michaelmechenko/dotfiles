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
        null_ls.builtins.formatting.asmfmt,
        -- null_ls.builtins.formatting.latexindent,
        null_ls.builtins.formatting.stylua,
        null_ls.builtins.formatting.prettier,
        require("none-ls.formatting.rustfmt"),
        null_ls.builtins.formatting.clang_format,
        -- diagnostics
        -- null_ls.builtins.diagnostics.markdownlint,
        -- null_ls.builtins.diagnostics.cppcheck,
        -- null_ls.builtins.diagnostics.cpplint,
        -- code actions
        null_ls.builtins.code_actions.refactoring,
        -- completions
        null_ls.builtins.completion.luasnip
      },
    })
  end,
}
