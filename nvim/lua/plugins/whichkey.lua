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
			{ "<leader>dh", hide_diagnostics, desc = "hide diagnostics" },
			{ "<leader>ds", show_diagnostics, desc = "show diagnostics" },

			-- buffers
			{ "<leader>b", group = "buffers" },
			{ "<leader>bc", desc = "prev buf" },
			{ "<leader>bv", desc = "next buf" },

			-- avante
			{ "<leader>a", group = "avante" },

			-- harpoon
			{ "<leader>m", group = "harpoon" },
			{ "<leader>ma", desc = "add file" },
			{ "<leader>mm", desc = "menu" },
			{ "<leader>m1", desc = "select 1" },
			{ "<leader>m2", desc = "select 2" },
			{ "<leader>m3", desc = "select 3" },
			{ "<leader>m4", desc = "select 4" },
			{ "<leader>mc", desc = "prev" },
			{ "<leader>mv", desc = "next" },

			-- neotree
			{ "<leader>r", group = "noeotree" },
			{ "<leader>re", "<cmd>Neotree filesystem reveal right<CR>", desc = "filesystem" },
			{ "<leader>rw", "<cmd>Neotree buffers reveal float<CR>", desc = "buffers" },
			{ "<leader>rq", "<cmd>Neotree close<CR>", desc = "close" },
			{ "<leader>rb", "<cmd>Neotree git_status reveal float<CR>", desc = "git status" },

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
					require("trouble").toggle({ mode = "lsp_references" })
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
					require("trouble").toggle("diagnostics")
				end,
				desc = "diagnostics",
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
				"<leader>xl",
				function()
					require("trouble").toggle("lsp_main")
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
				"<leader>ff",
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
