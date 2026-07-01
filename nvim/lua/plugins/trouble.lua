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
      c = "fold_toggle",
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

    -- toggle trouble window position (bottom <-> right), retain focus/fold level
    vim.keymap.set("n", "<leader>xt", function()
      local trouble = require("trouble")
      for _, pair in ipairs(position_pairs) do
        local mode, target = pair[1], pair[2]
        if trouble.is_open(mode) then
          if target == mode then
            return -- no position toggle for this mode
          end

          local source_view = trouble.open({ mode = mode, focus = false, refresh = false })
          if not source_view then
            return
          end

          local had_trouble_focus = source_view.win
            and source_view.win.win
            and vim.api.nvim_get_current_win() == source_view.win.win

          local fold_level = source_view.renderer and source_view.renderer.foldlevel
          if fold_level == nil
            and source_view.win
            and source_view.win.win
            and vim.api.nvim_win_is_valid(source_view.win.win)
          then
            fold_level = vim.wo[source_view.win.win].foldlevel
          end

          trouble.close(mode)

          local target_view = trouble.open({ mode = target, focus = had_trouble_focus, refresh = false })
          if target_view and fold_level ~= nil then
            target_view:wait(function()
              target_view:fold_level({ level = fold_level })
            end)
          end
          return
        end
      end
    end, { desc = "toggle trouble position" })
  end,
}
