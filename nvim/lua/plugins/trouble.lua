return {
  "folke/trouble.nvim",
  dependencies = { "nvim-tree/nvim-web-devicons" },
  opts = {
    keys = {
      j = "next",
      k = "prev",
    },
    modes = {
      diagnostics = {
        filter = { buf = 0 }, -- filter diagnostics to the current buffer
        win = {
          type = "split",
          relative = "win",
          position = "bottom",
          size = 0.5,
        },
      },
      lsp_references = {
        win = {
          type = "split",
          relative = "win",
          position = "right",
          size = 0.4,
        },
      },
      lsp_main = {
        mode = "lsp",
        focus = true,
        win = {
          type = "split",
          position = "bottom",
          size = 0.6,
        },
      },
      functions_main = {
        mode = "lsp_document_symbols",
        focus = true,
        filter = {
          kind = {
            "Function",
            "Method",
          },
        },
        win = {
          type = "split",
          relative = "win",
          position = "bottom",
          size = 0.4,
        },
      },
      symbols_main = {
        mode = "lsp_document_symbols",
        focus = true,
        win = {
          type = "split",
          relative = "win",
          position = "bottom",
          size = 0.4,
        },
      },
    },
  },
}
