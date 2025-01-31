local function hide_diagnostics()
	vim.diagnostic.config({
		virtual_text = false,
		signs = false,
		underline = false,
	})
end

local function show_diagnostics()
	vim.diagnostic.config({
		virtual_text = true,
		signs = true,
		underline = true,
	})
end

return {
	"folke/which-key.nvim",
	event = "VeryLazy",
	config = function()
		local wk = require("which-key")
		wk.add({
			-- format
			{ "<leader>q", vim.lsp.buf.format, desc = "format" },

			-- window
			{ "<leader>w", "<c-w>", desc = "window" },

			-- diagnostics
			{ "<leader>d", group = "diagnostics" },
			{
				"<leader>dh",
				hide_diagnostics,
				desc = "hide diagnostics",
			},
			{
				"<leader>ds",
				show_diagnostics,
				desc = "show diagnostics",
			},

			-- remove highlight
			{
				"<leader>df",
				"<cmd>noh<CR>",
				desc = "remove highlights",
			},

			-- buffers
			{ "<leader>b", group = "buffers" },
			{ "<leader>bc", desc = "prev buf" },
			{ "<leader>bv", desc = "next buf" },

			-- codecomp
			{ "<leader>a", group = "codecomp" },
			{ "<leader>ae", mode = { "v" }, ":CodeCompanion ", desc = "inline vertical" },
			{ "<leader>ae", mode = { "n" }, "<Cmd>CodeCompanion<CR>", desc = "open" },
			{ "<leader>as", mode = { "n", "v" }, "<Cmd>CodeCompanionChat<CR>", desc = "cc chat buffer" },
			{ "<leader>ad", mode = { "n", "v" }, "<Cmd>CodeCompanionActions<CR>", desc = "cc actions" },

			-- git signs
			{ "<leader>g", group = "git" },
			{
				"<leader>gs",
				"<cmd>Gitsigns toggle_signs<CR>",
				desc = "gitsigns toggle",
			},

			-- harpoon
			{ "<leader>m", group = "harpoon" },
			{ "<leader>ma", desc = "add file" },
			{ "<leader>me", desc = "menu" },
			{ "<leader>mc", desc = "prev" },
			{ "<leader>mv", desc = "next" },

			-- -- bufferline
			-- { "<leader>1", "<cmd>BufferLineGoToBuffer 1<CR>", hidden = true },
			-- { "<leader>2", "<cmd>BufferLineGoToBuffer 2<CR>", hidden = true },
			-- { "<leader>3", "<cmd>BufferLineGoToBuffer 3<CR>", hidden = true },
			-- { "<leader>4", "<cmd>BufferLineGoToBuffer 4<CR>", hidden = true },
			-- { "<leader>5", "<cmd>BufferLineGoToBuffer 5<CR>", hidden = true },
			-- { "<leader>6", "<cmd>BufferLineGoToBuffer 6<CR>", hidden = true },
			-- { "<leader>7", "<cmd>BufferLineGoToBuffer 7<CR>", hidden = true },

			-- lualine
			{ "<leader>1", "<cmd>LualineBuffersJump 1<CR>", hidden = true },
			{ "<leader>2", "<cmd>LualineBuffersJump 2<CR>", hidden = true },
			{ "<leader>3", "<cmd>LualineBuffersJump 3<CR>", hidden = true },
			{ "<leader>4", "<cmd>LualineBuffersJump 4<CR>", hidden = true },
			{ "<leader>5", "<cmd>LualineBuffersJump 5<CR>", hidden = true },
			{ "<leader>6", "<cmd>LualineBuffersJump 6<CR>", hidden = true },
			{ "<leader>7", "<cmd>LualineBuffersJump 7<CR>", hidden = true },

			-- neotree
			{ "<leader>r", group = "noeotree" },
			{ "<leader>re", "<cmd>Neotree filesystem reveal right<CR>:set relativenumber<CR>", desc = "filesystem" },
			{ "<leader>rw", "<cmd>Neotree buffers reveal float<CR>:set relativenumber<CR>", desc = "buffers" },
			{ "<leader>rq", "<cmd>Neotree close<CR>", desc = "close" },
			{ "<leader>rb", "<cmd>Neotree git_status reveal float<CR>:set relativenumber<CR>", desc = "git status" },

			-- mini
			{ "<leader>e", "<cmd>lua MiniFiles.open()<CR>:set relativenumber<CR>", desc = "filetree" },

			-- dim
			{ "<leader>z", group = "dim" },
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

			-- sessions
			{ "<leader>n", group = "sessions" },
			{
				"<leader>ne",
				"<cmd>SessionSearch<CR>",
				desc = "session manager",
			},
			{
				"<leader>ns",
				"<cmd>SessionSave<CR>",
				desc = "session save",
			},

			-- snacks
			-- terminal
			{ "<leader>t", group = "snacks" },
			{
				"<leader>te",
				function()
					require("snacks").terminal.open()
				end,
				desc = "new terminal window",
			},
			{
				"<leader>tt",
				function()
					require("snacks").terminal.toggle()
				end,
				desc = "toggle terminal window",
			},

			-- trouble
			{ "<leader>x", group = "trouble" },
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
				"<leader>xr",
				function()
					require("trouble").toggle({ mode = "lsp_references" }).focus({ true })
				end,
				desc = "lsp references",
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
					require("trouble").toggle("diagnostics").focus({ true })
				end,
				desc = "diagnostics",
			},
			{
				"<leader>xf",
				function()
					require("trouble").toggle("functions_main").focus({ true })
				end,
				desc = "functions",
			},
			{
				"<leader>xs",
				function()
					require("trouble").toggle("symbols_main").focus({ true })
				end,
				desc = "symbols",
			},
			{
				"<leader>xl",
				function()
					require("trouble").toggle("lsp_main").focus({ true })
				end,
				desc = "lsp",
			},

			-- lsp
			{ "<leader>l", group = "lsp" },
			{ "<leader>ll", vim.lsp.buf.hover, desc = "hover" },
			{ "<leader>lo", vim.diagnostic.open_float, desc = "open diagnostic float" },
			{ "<leader>lk", vim.lsp.buf.definition, desc = "definition" },
			{ "<leader>lm", vim.lsp.buf.code_action, desc = "code action" },

			-- telescope
			{ "<leader>f", group = "telescope" },
			{
				"<leader>fe",
				function()
					require("telescope.builtin").find_files({})
				end,
				desc = "find files",
			},
			{
				"<leader>fd",
				function()
					require("telescope.builtin").lsp_references({})
				end,
				desc = "lsp references",
			},
			{
				"<leader>fh",
				function()
					require("telescope.builtin").help_tags()
				end,
				desc = "help_tags",
			},
			{
				"<leader>fm",
				function()
					require("telescope.builtin").man_pages()
				end,
				desc = "man pages",
			},
			{
				"<leader>fq",
				function()
					require("telescope.builtin").quickfix()
				end,
				desc = "quickfix",
			},
			{
				"<leader>fw",
				function()
					require("telescope.builtin").buffers({ show_all_buffers = true })
				end,
				desc = "buffers",
			},
			{
				"<leader>ft",
				function()
					require("telescope.builtin").treesitter()
				end,
				desc = "treesitter",
			},
			{
				"<leader>fs",
				function()
					require("telescope.builtin").lsp_document_symbols({ show_line = true })
				end,
				desc = "doc symbols",
			},
			{
				"<leader>fr",
				function()
					require("telescope.builtin").oldfiles()
				end,
				desc = "recent files",
			},
			{
				"<leader>fg",
				function()
					require("telescope.builtin").live_grep()
				end,
				desc = "live grep",
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
	opts = {},
}
