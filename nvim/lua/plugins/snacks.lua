require("kanagawa").load("wave")

return {
	{
		"folke/snacks.nvim",
		priority = 1000,
		lazy = false,
		opts = {
			bigfile = { enabled = true },
			-- notifier = { enabled = true },
			quickfile = { enabled = true },
			-- statuscolumn = { enabled = true },
			-- words = { enabled = true },
			terminal = {},
			scroll = {
				animate = {
					duration = { step = 10, total = 175 },
					easing = "linear",
				},
			},
			dim = {
				{
					scope = {
						min_size = 5,
						max_size = 20,
						siblings = true,
					},
					animate = {
						enabled = vim.fn.has("nvim-0.10") == 1,
						easing = "outQuad",
						duration = {
							step = 10, -- ms per step
							total = 200, -- maximum duration
						},
					},
					-- what buffers to dim
					filter = function(buf)
						return vim.g.snacks_dim ~= false
							and vim.b[buf].snacks_dim ~= false
							and vim.bo[buf].buftype == ""
					end,
				},
			},
			indent = {
				chunk = {
					enabled = false,
				},
				animate = {
					enabled = false,
				},
				scope = {
					enabled = true,
					priority = 200,

					-- • left aligned solid
					--   • `▏`
					--   • `▎` (default)
					--   • `▍`
					-- • center aligned solid
					--   • `│`
					--   • `┃`
					-- • right aligned solid
					--   • `▕`
					--   • `▐`
					-- • center aligned dashed
					--   • `╎`
					--   • `╏`
					--   • `┆`
					--   • `┇`
					--   • `┊`
					--   • `┋`
					-- • center aligned double
					--   • `║`

					-- char = "│",
					char = "┊",
					underline = false,
					only_current = false,
					-- hl = "SnacksIndentScope",
					-- hl = "Special",
					hl = "Statement",
					-- hl = "CursorLineNr",
				},
				picker = {
					finder = "explorer",
					sort = { fields = { "sort" } },
					tree = true,
					supports_live = true,
					follow_file = true,
					focus = "list",
					auto_close = true,
					jump = { close = false },
					layout = { preset = "sidebar", preview = false },
					formatters = { file = { filename_only = true } },
					matcher = { sort_empty = true },
					config = function(opts)
						return require("snacks.picker.source.explorer").setup(opts)
					end,
					win = {
						list = {
							keys = {
								["<BS>"] = "explorer_up",
								["a"] = "explorer_add",
								["d"] = "explorer_del",
								["r"] = "explorer_rename",
								["c"] = "explorer_copy",
								["m"] = "explorer_move",
								["y"] = "explorer_yank",
								["<c-c>"] = "explorer_cd",
								["."] = "explorer_focus",
							},
						},
					},
				},
			},
		},
	},
}
