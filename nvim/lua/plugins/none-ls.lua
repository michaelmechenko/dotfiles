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
        null_ls.builtins.formatting.stylua,
        null_ls.builtins.formatting.prettier,
        require("none-ls.formatting.ruff"),
        require("none-ls.formatting.rustfmt"),
        null_ls.builtins.formatting.clang_format,
        -- diagnostics
        require("none-ls.diagnostics.ruff"),
        require("none-ls.diagnostics.cpplint"),
        null_ls.builtins.diagnostics.markdownlint,
        null_ls.builtins.diagnostics.cppcheck,
        -- code actions
        null_ls.builtins.code_actions.refactoring,
        -- completions
        -- null_ls.builtins.completion.spell,
        null_ls.builtins.completion.luasnip
      },
    })
  end,
}
