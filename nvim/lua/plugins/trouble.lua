return {
  "folke/trouble.nvim",
  dependencies = { "nvim-tree/nvim-web-devicons" },
  opts = {
    multiline = false,
    focus = true,
    indent_guides = true,
    keys = {
      j = "next",
      k = "prev",
      e = "jump",
    },
    modes = {
      diagnostics = {
        filter = { buf = 0 },
        win = {
          type = "split",
          focus = true,
          relative = "win",
          position = "bottom",
          size = 0.4,
        },
      },
      diagnostics_right = {
        filter = { buf = 0 },
        mode = "diagnostics",
        win = {
          type = "split",
          focus = true,
          relative = "win",
          position = "right",
          size = 0.4,
        },
      },
      lsp_references = {
        win = {
          type = "split",
          focus = true,
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
          position = "right",
          size = 0.4,
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
          position = "right",
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
      symbols_right = {
        mode = "lsp_document_symbols",
        focus = true,
        win = {
          type = "split",
          relative = "win",
          position = "right",
          size = 0.4,
        },
      },
    },
  },
  config = function(_, opts)
    require("trouble").setup(opts)
    local trouble_helpers = require("utils.trouble")

    -- ordered: bottom mode -> right mode (first open wins)
    local position_pairs = {
      { "diagnostics", "diagnostics_right" },
      { "symbols_main", "symbols_right" },
      { "diagnostics_right", "diagnostics" },
      { "symbols_right", "symbols_main" },
      -- modes below have no position toggle
      { "lsp_main", "lsp_main" },
      { "lsp_references", "lsp_references" },
      { "functions_main", "functions_main" },
    }

    -- toggle trouble window position (bottom <-> right), focus stays in editor
    vim.keymap.set("n", "<leader>xt", function()
      local trouble = require("trouble")
      for _, pair in ipairs(position_pairs) do
        local mode, target = pair[1], pair[2]
        if trouble.is_open(mode) then
          if target == mode then
            return -- no position toggle for this mode
          end
          trouble.close(mode)
          trouble_helpers.open(target, { focus = false })
          return
        end
      end
    end, { desc = "Toggle Trouble position" })
  end,
}
