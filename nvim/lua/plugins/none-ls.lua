return {
  "nvimtools/none-ls.nvim",
  dependencies = {
    "nvimtools/none-ls-extras.nvim",
  },
  config = function()
    local null_ls = require("null-ls")

    null_ls.setup({
      sources = {
        null_ls.builtins.formatting.stylua,
        null_ls.builtins.formatting.prettier,
        -- python
        require("none-ls.diagnostics.ruff"),
        require("none-ls.formatting.ruff"),
        -- cpp
        require("none-ls.diagnostics.cpplint"),
        null_ls.builtins.formatting.clang_format,
        -- eslint
        -- require("none-ls.diagnostics.eslint_d"),
        -- require("none-ls.code_actions.eslint_d"),
        -- rust
        require("none-ls.formatting.rustfmt"),
        -- null_ls.builtins.completion.spell,
      },
    })
  end,
}
