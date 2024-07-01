return {
	"folke/which-key.nvim",
	qevent = "VeryLazy",
	init = function()
		vim.o.timeout = true
		vim.o.timeoutlen = 300
		local wk = require("which-key")
		wk.register({
			q = {
				name = "ai",
				q = { "<cmd>ChatGPT<CR>", "ChatGPT" },
				e = { "<cmd>ChatGPTEditWithInstruction<CR>", "Edit with instruction", mode = { "n", "v" } },
				g = { "<cmd>ChatGPTRun grammar_correction<CR>", "Grammar Correction", mode = { "n", "v" } },
				t = { "<cmd>ChatGPTRun translate<CR>", "Translate", mode = { "n", "v" } },
				k = { "<cmd>ChatGPTRun keywords<CR>", "Keywords", mode = { "n", "v" } },
				d = { "<cmd>ChatGPTRun docstring<CR>", "Docstring", mode = { "n", "v" } },
				a = { "<cmd>ChatGPTRun add_tests<CR>", "Add Tests", mode = { "n", "v" } },
				o = { "<cmd>ChatGPTRun optimize_code<CR>", "Optimize Code", mode = { "n", "v" } },
				s = { "<cmd>ChatGPTRun summarize<CR>", "Summarize", mode = { "n", "v" } },
				f = { "<cmd>ChatGPTRun fix_bugs<CR>", "Fix Bugs", mode = { "n", "v" } },
				x = { "<cmd>ChatGPTRun explain_code<CR>", "Explain Code", mode = { "n", "v" } },
				r = { "<cmd>ChatGPTRun roxygen_edit<CR>", "Roxygen Edit", mode = { "n", "v" } },
				l = {
					"<cmd>ChatGPTRun code_readability_analysis<CR>",
					"Code Readability Analysis",
					mode = { "n", "v" },
				},
			},

			r = {
				name = "neotree",
				r = { "<cmd>Neotree filesystem reveal left<CR>", "filesystem" },
				w = { "<cmd>Neotree buffers reveal left<CR>", "buffers" },
				q = { "<cmd>Neotree close<CR>", "git status" },
				b = { "<cmd>Neotree git_status reveal float<CR>", "git status" },
			},

			x = {
				name = "trouble",
				x = {
					function()
						require("trouble").toggle("diagnostics")
						require("trouble").focus({ true })
					end,
					"diagnostics",
				},
				q = {
					function()
						require("trouble").toggle("quickfix")
						require("trouble").focus({ true })
					end,
					"quickfix",
				},
				l = {
					function()
						require("trouble").toggle("loclist")
						require("trouble").focus({ true })
					end,
					"local list",
				},
				r = {
					function()
						require("trouble").toggle("lsp_references")
						require("trouble").focus({ true })
					end,
					"references",
				},
			},

			l = {
				name = "lsp",
				l = {
					vim.lsp.buf.hover,
					"hover",
				},
				k = {
					vim.lsp.buf.definition,
					"definition",
				},
				m = {
					vim.lsp.buf.code_action,
					"code action",
				},
			},

			f = {
				name = "telescope",
				f = {
					function()
						local builtin = require("telescope.builtin")
						vim.keymap.set("n", "<leader>ff", builtin.find_files, {})
					end,
					"find files",
				},
				d = {
					function()
						local builtin = require("telescope.builtin")
						vim.keymap.set("n", "<leader>fd", builtin.live_grep, {})
					end,
					"live grep",
				},
				m = {
					function()
						local builtin = require("telescope.builtin")
						vim.keymap.set("n", "<leader>fm", builtin.man_pages, {})
					end,
					"man pages",
				},
				q = {
					function()
						local builtin = require("telescope.builtin")
						vim.keymap.set("n", "<leader>fq", builtin.quickfix, {})
					end,
					"quick fix",
				},
				t = {
					function()
						local builtin = require("telescope.builtin")
						vim.keymap.set("n", "<leader>ft", builtin.treesitter, {})
					end,
					"treesitter",
				},
			},
		}, { prefix = "<leader>" })
	end,
	opts = {},
}
