return {
  {
    "neovim/nvim-lspconfig",
    init = function()
      vim.o.completeopt = "menu,menuone,noselect,popup,preinsert"
      vim.o.complete = ".^5,w^5,b^5"
      vim.o.autocomplete = true
      vim.o.pumborder = "rounded"
    end,
    config = function()
      -- Remove default CTRL-S signature help; we remap to CTRL-K
      pcall(vim.keymap.del, "i", "<C-S>")

      local pum = function()
        return vim.fn.pumvisible() == 1
      end

      -- Helper: find signature help float window
      -- Track the last signature window so we can find/scroll/close it
      local signature_win = nil

      -- Intercept signature_help to capture the window
      local orig_signature_help = vim.lsp.buf.signature_help
      vim.lsp.buf.signature_help = function(opts)
        orig_signature_help(opts)
        -- Give the float a moment to open, then find it
        vim.schedule(function()
          for _, win in ipairs(vim.api.nvim_tabpage_list_wins(0)) do
            local cfg = vim.api.nvim_win_get_config(win)
            if cfg.relative ~= "" then
              local buf = vim.api.nvim_win_get_buf(win)
              local ft = vim.bo[buf].filetype
              if ft == "lsp-signature-help" then
                signature_win = win
                return
              end
            end
          end
          -- noice renders signatures with markdown filetype; find newest float
          for _, win in ipairs(vim.api.nvim_tabpage_list_wins(0)) do
            local cfg = vim.api.nvim_win_get_config(win)
            if cfg.relative ~= "" and vim.bo[vim.api.nvim_win_get_buf(win)].filetype == "markdown" then
              signature_win = win
              return
            end
          end
        end)
      end

      local function toggle_signature()
        -- Close if tracked window is still valid
        if signature_win and vim.api.nvim_win_is_valid(signature_win) then
          vim.api.nvim_win_close(signature_win, true)
          signature_win = nil
          return
        end
        signature_win = nil
        vim.lsp.buf.signature_help()
      end

      local function scroll_signature(dir)
        if not signature_win or not vim.api.nvim_win_is_valid(signature_win) then
          signature_win = nil
          return
        end
        local keys = dir == "up" and vim.api.nvim_replace_termcodes("<C-u>", true, true, true)
            or vim.api.nvim_replace_termcodes("<C-d>", true, true, true)
        vim.api.nvim_win_call(signature_win, function()
          vim.api.nvim_feedkeys(keys, "nx", false)
        end)
      end

      -- Accept: <C-e> → <C-y> when pum visible
      vim.keymap.set("i", "<C-e>", function()
        if pum() then return "<C-y>" end
        return "<C-e>"
      end, { expr = true })

      -- Dismiss: <C-q> → <C-e> when pum visible
      vim.keymap.set("i", "<C-q>", function()
        if pum() then return "<C-e>" end
      end, { expr = true })

      -- Select next: <C-s> → <C-n> when pum visible
      vim.keymap.set("i", "<C-s>", function()
        if pum() then return "<C-n>" end
        return "<C-s>"
      end, { expr = true })

      -- Select prev: <C-w> → <C-p> when pum visible, else delete word
      vim.keymap.set("i", "<C-w>", function()
        if pum() then return "<C-p>" end
        return "<C-w>"
      end, { expr = true })

      -- Toggle signature help: <C-k>
      vim.keymap.set("i", "<C-k>", toggle_signature)

      -- Scroll signature float
      vim.keymap.set("i", "<C-U>", function() scroll_signature("up") end)
      vim.keymap.set("i", "<C-D>", function() scroll_signature("down") end)
    end,
  },
}

