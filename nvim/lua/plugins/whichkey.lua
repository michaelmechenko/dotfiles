return {
  "folke/which-key.nvim",
  qevent = "VeryLazy",
  init = function()
    local wk = require("which-key")
    wk.add({
      -- chad gpt
      { "<leader>q",  group = "ai" },
      { "<leader>qq", "<cmd>ChatGPT<CR>",                    desc = "chatgpt" },
      { "<leader>qe", "<cmd>ChatGPTEditWithInstruction<CR>", desc = "edit w instruction", mode = { "n", "v" } },
      {
        "<leader>qg",
        "<cmd>ChatGPTRun grammar_correction<CR>",
        desc = "grammar Correction",
        mode = { "n", "v" },
      },
      {
        "<leader>qt",
        "<cmd>ChatGPTRun translate<CR>",
        desc = "translate",
        mode = { "n", "v" },
      },
      {
        "<leader>qk",
        "<cmd>ChatGPTRun keywords<CR>",
        desc = "keywords",
        mode = { "n", "v" },
      },
      {
        "<leader>qd",
        "<cmd>ChatGPTRun docstring<CR>",
        desc = "docstring",
        mode = { "n", "v" },
      },
      {
        "<leader>qa",
        "<cmd>ChatGPTRun add_tests<CR>",
        desc = "add tests",
        mode = { "n", "v" },
      },
      {
        "<leader>qo",
        "<cmd>ChatGPTRun optimize_code<CR>",
        desc = "optimize code",
        mode = { "n", "v" },
      },
      {
        "<leader>qs",
        "<cmd>ChatGPTRun summarize<CR>",
        desc = "summarize",
        mode = { "n", "v" },
      },
      {
        "<leader>qf",
        "<cmd>ChatGPTRun fix_bugs<CR>",
        desc = "fix bugs",
        mode = { "n", "v" },
      },
      {
        "<leader>qx",
        "<cmd>ChatGPTRun explain_code<CR>",
        desc = "explain code",
        mode = { "n", "v" },
      },
      {
        "<leader>qr",
        "<cmd>ChatGPTRun roxygen_edit<CR>",
        desc = "roxygen edit",
        mode = { "n", "v" },
      },
      {
        "<leader>ql",
        "<cmd>ChatGPTRun code_readability_analysis<CR>",
        desc = "code readibility analytics",
        mode = { "n", "v" },
      },

      -- neotree
      { "<leader>r",  group = "noeotree" },
      { "<leader>rr", "<cmd>Neotree filesystem reveal right<CR>", desc = "filesystem" },
      { "<leader>rw", "<cmd>Neotree buffers reveal right<CR>",    desc = "buffers" },
      { "<leader>rq", "<cmd>Neotree close<CR>",                   desc = "close" },
      { "<leader>rb", "<cmd>Neotree git_status reveal float<CR>", desc = "git status" },

      -- trouble
      { "<leader>x",  group = "trouble" },
      {
        "<leader>xx",
        function()
          if require("trouble").is_open() then
            require("trouble").focus({ true })
          end
        end,
        desc = "focus",
      },
      {
        "<leader>xr",
        function()
            require("trouble").refresh({ true })
        end,
        desc = "focus",
      },
      {
        "<leader>xq",
        function()
          if require("trouble").is_open() then
            require("trouble").close({})
          end
        end,
        desc = "close",
      },
      {
        "<leader>xd",
        function()
          require("trouble").toggle("diagnostics")
        end,
        desc = "diagnostics",
      },
      {
        "<leader>xs",
        "<cmd>Trouble toggle symbols win.size=0.3<CR>",
        -- function()
        --   require("trouble").toggle("symbols")
        -- end,
        desc = "symbols",
      },
      {
        "<leader>xl",
        "<cmd>Trouble toggle lsp win.size=0.3<CR>",
        -- function()
        --   require("trouble").toggle("lsp")
        -- end,
        desc = "lsp",
      },

      -- lsp
      { "<leader>l",  group = "lsp" },
      { "<leader>ll", vim.lsp.buf.hover,       desc = "hover" },
      { "<leader>lk", vim.lsp.buf.definition,  desc = "definition" },
      { "<leader>lm", vim.lsp.buf.code_action, desc = "code action" },

      -- telescope
      { "<leader>f",  group = "telescope" },
      {
        "<leader>ff",
        function()
          local builtin = require("telescope.builtin")
          vim.keymap.set("n", "<leader>ff", builtin.find_files, {})
        end,
        desc = "find files",
      },
      {
        "<leader>fd",
        function()
          local builtin = require("telescope.builtin")
          vim.keymap.set("n", "<leader>fd", builtin.live_grep, {})
        end,
        desc = "live grep",
      },
      {
        "<leader>fm",
        function()
          local builtin = require("telescope.builtin")
          vim.keymap.set("n", "<leader>fm", builtin.man_pages, {})
        end,
        desc = "man pages",
      },
      {
        "<leader>fq",
        function()
          local builtin = require("telescope.builtin")
          vim.keymap.set("n", "<leader>fq", builtin.quickfix, {})
        end,
        desc = "quickfix",
      },
      {
        "<leader>ft",
        function()
          local builtin = require("telescope.builtin")
          vim.keymap.set("n", "<leader>ft", builtin.treesitter, {})
        end,
        desc = "treesitter",
      },
    })
  end,
  opts = {},
}
