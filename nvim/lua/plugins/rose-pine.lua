return {
	{
		"rose-pine/neovim",
		name = "rose-pine",
		config = function()
			require("rose-pine").setup({
				variant = "main", -- auto, main, moon, or dawn
				dark_variant = "main", -- main, moon, or dawn
				dim_inactive_windows = true,
				extend_background_behind_borders = true,

				enable = {
					terminal = true,
					legacy_highlights = true, -- Improve compatibility for previous versions of Neovim
					migrations = true, -- Handle deprecated options automatically
				},

				styles = {
					bold = true,
					italic = false,
					transparency = true,
				},

				groups = {
					border = "muted",
					link = "iris",
					panel = "surface",

					error = "love",
					hint = "iris",
					info = "foam",
					note = "pine",
					todo = "rose",
					warn = "gold",

					git_add = "foam",
					git_change = "rose",
					git_delete = "love",
					git_dirty = "rose",
					git_ignore = "muted",
					git_merge = "iris",
					git_rename = "pine",
					git_stage = "iris",
					git_text = "rose",
					git_untracked = "subtle",

					h1 = "iris",
					h2 = "foam",
					h3 = "rose",
					h4 = "gold",
					h5 = "pine",
					h6 = "foam",
				},

				highlight_groups = {
					-- Comment = { fg = "foam" },
					-- VertSplit = { fg = "muted", bg = "muted" },
					AvanteConflictCurrent = { bg = "highlight_low", bold = true },
					AvanteConflictCurrentLabel = { fg = "text", bg = "#907aa9", bold = true },
					AvanteConflictIncoming = { bg = "highlight_low", bold = true },
					AvanteConflictIncomingLabel = { fg = "text", bg = "#b4637a", bold = true },

          -- syntax highlighting
					-- ["@keyword"] = { fg = "#61abb8" },
					-- ["@keyword.type"] = { fg = "#61abb8" },
					-- ["@keyword.import"] = { fg = "#61abb8" },
					["@property"] = { fg = "#caaded" },
					-- ["@variable"] = { fg = "#dfdad9" },
					["@number"] = { fg = "#dfdad9" },
					["@boolean"] = { fg = "#dfdad9" },
					-- ["@function"] = { fg = "#f59dab" },
					-- ["@function.builtin"] = { fg = "love" },
					-- ["@function.call"] = { fg = "#f59dab" },
				},
			})

			vim.cmd("colorscheme rose-pine")
			vim.opt.cursorline = true
			-- vim.cmd("colorscheme rose-pine-main")
			-- vim.cmd("colorscheme rose-pine-moon")
			-- vim.cmd("colorscheme rose-pine-dawn")
		end,
	},
}
