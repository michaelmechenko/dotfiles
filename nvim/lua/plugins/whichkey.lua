local function show_diagnostics()
  vim.diagnostic.config({
    virtual_text = true,
    signs = true,
    underline = true,
  })
end

local function hide_diagnostics()
  vim.diagnostic.config({
    virtual_text = false,
    signs = false,
    underline = false,
  })
end

return {
  "folke/which-key.nvim",
  event = "VeryLazy",
  priority = 1000,
  opts = {
  },
  config = function()
    local wk = require("which-key")
    wk.add({
      -- format
      { "<leader>q", vim.lsp.buf.format,       desc = "format" },

      -- window
      { "<leader>w", "<c-w>",                  desc = "window" },

      -- diagnostics
      { "<leader>d", group = "diagnostics/DAP" },
      {
        "<leader>dds",
        show_diagnostics,
        desc = "show diagnostics",
      },
      {
        "<leader>ddh",
        hide_diagnostics,
        desc = "hide diagnostics",
      },

      -- remove highlight
      {
        "<leader>da",
        "<cmd>noh<CR>",
        desc = "remove highlights",
      },

      -- dap
      { "<leader>db",  "<Cmd>DapToggleBreakpoint<CR>", desc = "toggle breakpoint" },
      { "<leader>dsi", "<Cmd>DapStepInto<CR>",         desc = "step into" },
      { "<leader>dso", "<Cmd>DapStepOut<CR>",          desc = "step out" },
      { "<leader>dsr", "<Cmd>DapStepOver<CR>",         desc = "step over" },
      { "<leader>dr",  "<Cmd>DapContinue<CR>",         desc = "continue dap" },
      { "<leader>dq",  "<Cmd>DapTerminate<CR>",        desc = "terminate dap" },

      -- buffers
      { "<leader>b",   group = "buffers" },
      { "<leader>bc",  desc = "prev buf" },
      { "<leader>bv",  desc = "next buf" },

      -- codecomp
      { "<leader>a",   group = "codecomp" },
      {
        "<leader>ae",
        mode = { "v" },
        ":CodeCompanion ",
        desc = "inline vertical",
      },
      { "<leader>ae", mode = { "n" },      "<Cmd>CodeCompanion<CR>",                                                                                                    desc = "open float" },
      { "<leader>ab", mode = { "n" },      function() require("codecompanion").toggle({ window_opts = { layout = "buffer" } }) end,                                     desc = "open buffer" },
      { "<leader>ar", mode = { "n" },      function() require("codecompanion").toggle({ window_opts = { layout = "vertical", position = "right", width = 0.45 } }) end, desc = "open right" },
      { "<leader>as", mode = { "n", "v" }, function() require("codecompanion").toggle({ window_opts = { layout = "float" } }) end,                                      desc = "cc chat buffer" },
      { "<leader>ad", mode = { "n", "v" }, "<Cmd>CodeCompanionActions<CR>",                                                                                             desc = "cc actions" },

      -- git signs
      { "<leader>g",  group = "git" },
      {
        "<leader>gs",
        "<cmd>Gitsigns toggle_linehl<CR><cmd>Gitsigns toggle_numhl<CR>",
        desc = "gitsigns toggle all",
      },
      {
        "<leader>go",
        "<cmd>Gitsigns preview_hunk_inline<CR>",
        desc = "gitsigns preview hunk inline",
      },
      {
        "<leader>gl",
        "<cmd>Gitsigns toggle_linehl<CR>",
        desc = "gitsigns toggle line hl",
      },
      {
        "<leader>gw",
        "<cmd>Gitsigns toggle_word_diff<CR>",
        desc = "gitsigns toggle word diff",
      },
      {
        "<leader>gd",
        function()
          require("gitsigns").diffthis()
        end,
        desc = "gitsigns diff",
      },

      -- harpoon
      -- { "<leader>m",  group = "harpoon" },
      -- { "<leader>ma", desc = "add file" },
      -- { "<leader>me", desc = "menu" },
      -- { "<leader>mc", desc = "prev" },
      -- { "<leader>mv", desc = "next" },

      -- -- bufferline
      -- { "<leader>1", "<cmd>BufferLineGoToBuffer 1<CR>", hidden = true },
      -- { "<leader>2", "<cmd>BufferLineGoToBuffer 2<CR>", hidden = true },
      -- { "<leader>3", "<cmd>BufferLineGoToBuffer 3<CR>", hidden = true },
      -- { "<leader>4", "<cmd>BufferLineGoToBuffer 4<CR>", hidden = true },
      -- { "<leader>5", "<cmd>BufferLineGoToBuffer 5<CR>", hidden = true },
      -- { "<leader>6", "<cmd>BufferLineGoToBuffer 6<CR>", hidden = true },
      -- { "<leader>7", "<cmd>BufferLineGoToBuffer 7<CR>", hidden = true },

      -- lualine
      { "<leader>1",  "<cmd>LualineBuffersJump 1<CR>",                                       hidden = true },
      { "<leader>2",  "<cmd>LualineBuffersJump 2<CR>",                                       hidden = true },
      { "<leader>3",  "<cmd>LualineBuffersJump 3<CR>",                                       hidden = true },
      { "<leader>4",  "<cmd>LualineBuffersJump 4<CR>",                                       hidden = true },
      { "<leader>5",  "<cmd>LualineBuffersJump 5<CR>",                                       hidden = true },
      { "<leader>6",  "<cmd>LualineBuffersJump 6<CR>",                                       hidden = true },
      { "<leader>7",  "<cmd>LualineBuffersJump 7<CR>",                                       hidden = true },

      -- word wrap
      { "<leader>dw", "<cmd>set wrap!<CR>",                                                  desc = "word wrap" },

      -- neotree
      { "<leader>r",  group = "noeotree" },
      { "<leader>re", "<cmd>Neotree filesystem reveal right<CR>", desc = "filesystem" },
      { "<leader>rw", "<cmd>Neotree buffers reveal float<CR>",    desc = "buffers" },
      { "<leader>rq", "<cmd>Neotree close<CR>",                                              desc = "close" },
      { "<leader>rb", "<cmd>Neotree git_status reveal float<CR>", desc = "git status" },

      -- { "<leader>r", group = "explorer" },
      -- {
      -- 	"<leader>rq",
      -- 	function()
      -- 		require("snacks").explorer()
      -- 		-- vim.cmd([[set relativenumber]])
      -- 	end,
      -- 	desc = "filesystem",
      -- },
      -- {
      -- 	"<leader>re",
      -- 	function()
      -- 		require("snacks").explorer()
      -- 		-- vim.cmd([[set relativenumber]])
      -- 	end,
      -- 	desc = "filesystem",
      -- },

      -- mini
      { "<leader>e",  "<cmd>lua MiniFiles.open()<CR>:set relativenumber<CR>",                desc = "filetree" },

      -- dim
      { "<leader>z",  group = "dim" },
      {
        "<leader>zc",
        function()
          require("snacks").dim()
        end,
        desc = "enable dim",
      },
      {
        "<leader>zx",
        function()
          require("snacks").dim.disable()
        end,
        desc = "disable dim",
      },

      -- trouble
      { "<leader>x",  group = "trouble" },
      {
        "<leader>xz",
        function()
          if require("trouble").is_open() then
            require("trouble").focus({ true })
          end
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
        "<leader>xl",
        function()
          require("trouble").toggle("lsp_main")
        end,
        desc = "lsp main",
      },
      {

        "<leader>xD",
        function()
          require("trouble").toggle("lsp_declarations")
        end,
        desc = "lsp declarations",
      },
      {
        "<leader>xr",
        function()
          require("trouble").toggle("lsp_references")
        end,
        desc = "lsp references",
      },
      {
        "<leader>xR",
        function()
          require("trouble").toggle("lsp_type_definitions")
        end,
        desc = "lsp type definitions",
      },
      {
        "<leader>xf",
        function()
          require("trouble").toggle("functions_main")
        end,
        desc = "functions",
      },
      {
        "<leader>xs",
        function()
          require("trouble").toggle("symbols_main")
        end,
        desc = "symbols",
      },
      {
        "<leader>xQ",
        function()
          require("trouble").toggle("qflist")
        end,
        desc = "quickfix",
      },

      -- lsp
      { "<leader>l",  group = "lsp" },
      { "K",          function() vim.lsp.buf.hover() end,          desc = "hover" },
      { "<leader>ls", function() vim.lsp.buf.signature_help() end, desc = "signature help" },
      { "<leader>lo", function() vim.diagnostic.open_float() end,  desc = "open diagnostic float" },
      { "<leader>ld", function() vim.lsp.buf.definition() end,     desc = "definition" },
      { "<leader>lm", function() vim.lsp.buf.code_action() end,    desc = "code action" },

      -- telescope
      -- { "<leader>f", group = "telescope" },
      -- {
      -- 	"<leader>fe",
      -- 	function()
      -- 		require("telescope.builtin").find_files({})
      -- 	end,
      -- 	desc = "find files",
      -- },
      -- {
      -- 	"<leader>fd",
      -- 	function()
      -- 		require("telescope.builtin").lsp_references({})
      -- 	end,
      -- 	desc = "lsp references",
      -- },
      -- {
      -- 	"<leader>fh",
      -- 	function()
      -- 		require("telescope.builtin").help_tags()
      -- 	end,
      -- 	desc = "help_tags",
      -- },
      -- {
      -- 	"<leader>fm",
      -- 	function()
      -- 		require("telescope.builtin").man_pages()
      -- 	end,
      -- 	desc = "man pages",
      -- },
      -- {
      -- 	"<leader>fq",
      -- 	function()
      -- 		require("telescope.builtin").quickfix()
      -- 	end,
      -- 	desc = "quickfix",
      -- },
      -- {
      -- 	"<leader>fw",
      -- 	function()
      -- 		require("telescope.builtin").buffers({ show_all_buffers = true })
      -- 	end,
      -- 	desc = "buffers",
      -- },
      -- {
      -- 	"<leader>ft",
      -- 	function()
      -- 		require("telescope.builtin").treesitter()
      -- 	end,
      -- 	desc = "treesitter",
      -- },
      -- {
      -- 	"<leader>fs",
      -- 	function()
      -- 		require("telescope.builtin").lsp_document_symbols({ show_line = true })
      -- 	end,
      -- 	desc = "doc symbols",
      -- },
      -- {
      -- 	"<leader>fr",
      -- 	function()
      -- 		require("telescope.builtin").oldfiles()
      -- 	end,
      -- 	desc = "recent files",
      -- },
      -- {
      -- 	"<leader>fg",
      -- 	function()
      -- 		require("telescope.builtin").live_grep()
      -- 	end,
      -- 	desc = "live grep",
      -- },

      -- scrollbar
      { "<leader>sd", "<Cmd>ScrollbarToggle<CR>",                  desc = "toggle scrollbar" },

      --snacks picker
      { "<leader>f",  group = "snacks picker" },
      {
        "<leader>fe",
        function()
          require("snacks").picker.files({})
        end,
        desc = "find files",
      },
      {
        "<leader>fd",
        function()
          require("snacks").picker.lsp_references({})
        end,
        desc = "lsp references",
      },
      {
        "<leader>fh",
        function()
          require("snacks").picker.help()
        end,
        desc = "help tags",
      },
      {
        "<leader>fm",
        function()
          require("snacks").picker.man()
        end,
        desc = "man pages",
      },
      {
        "<leader>fq",
        function()
          require("snacks").picker.quickfix()
        end,
        desc = "quickfix",
      },
      {
        "<leader>fw",
        function()
          require("snacks").picker.buffers({})
        end,
        desc = "buffers",
      },
      {
        "<leader>ft",
        function()
          require("snacks").picker.treesitter()
        end,
        desc = "treesitter",
      },
      {
        "<leader>fs",
        function()
          require("snacks").picker.lsp_symbols({})
        end,
        desc = "doc symbols",
      },
      {
        "<leader>fr",
        function()
          require("snacks").picker.recent()
        end,
        desc = "recent files",
      },
      {
        "<leader>fg",
        function()
          require("snacks").picker.grep()
        end,
        desc = "live grep",
      },

      -- undotree
      {
        "<leader>u",
        "<cmd>UndotreeToggle<CR>",
        desc = "undotree window",
      },

      -- hover
      { "<leader>h", group = "hover" },
      {
        "<leader>hh",
        function()
          require("hover").hover()
        end,
        desc = "hover",
      },
      {
        "<leader>hs",
        function()
          require("hover").hover_select()
        end,
        desc = "hover select",
      },
      {
        "<leader>hq",
        function()
          require("hover").hover_switch("previous")
        end,
        desc = "previous source",
      },
      {
        "<leader>he",
        function()
          require("hover").hover_switch("next")
        end,
        desc = "next source source",
      },

      -- surround
      { "<leader>s", group = "surround" },
    })
  end,
}
