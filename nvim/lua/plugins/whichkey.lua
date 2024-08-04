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
          require("trouble").toggle("diagnostics")
          require("trouble").focus({ true })
        end,
        desc = "diagnostics",
      },
      {
        "<leader>xq",
        function()
          require("trouble").toggle("quickfix")
          require("trouble").focus({ true })
        end,
        desc = "quickfix",
      },
      {
        "<leader>xl",
        function()
          require("trouble").toggle("loclist")
          require("trouble").focus({ true })
        end,
        desc = "loclist",
      },
      {
        "<leader>xr",
        function()
          require("trouble").toggle("lsp_references")
          require("trouble").focus({ true })
        end,
        desc = "lsp references",
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
