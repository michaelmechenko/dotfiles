return {
	"nvim-lualine/lualine.nvim",
	dependencies = { "nvim-tree/nvim-web-devicons" },
	config = function()
		local theme = require("kanagawa.colors").setup().theme
		local kanagawa = {}

		theme.syn.fun = "#957FB8"
		theme.ui.fg_dim = "#57576b"

		kanagawa.normal = {
			a = {
				bg = "#957FB8",
				fg = theme.ui.bg_m3,
			},
			b = { bg = theme.ui.bg_p1, fg = theme.syn.fun },
			c = { bg = theme.ui.bg_p1, fg = theme.ui.fg },
		}

		kanagawa.insert = {
			a = { bg = theme.diag.fun, fg = theme.ui.bg },
			b = { bg = theme.ui.bg_p1, fg = theme.diag.fun },
		}

		kanagawa.command = {
			a = { bg = theme.syn.operator, fg = theme.ui.bg },
			b = { bg = theme.ui.bg_p1, fg = theme.syn.operator },
		}

		kanagawa.visual = {
			a = { bg = theme.syn.keyword, fg = theme.ui.bg },
			b = { bg = theme.ui.bg_p1, fg = theme.syn.keyword },
		}

		kanagawa.replace = {
			a = { bg = theme.syn.constant, fg = theme.ui.bg },
			b = { bg = theme.ui.bg_p1, fg = theme.syn.constant },
		}

		kanagawa.inactive = {
			a = { bg = theme.ui.bg_p1, fg = theme.ui.fg_dim },
			b = { bg = theme.ui.bg_p1, fg = theme.ui.fg_dim, gui = "bold" },
			c = { bg = theme.ui.bg_p1, fg = theme.ui.fg_dim },
		}

		if vim.g.kanagawa_lualine_bold then
			for _, mode in pairs(kanagawa) do
				mode.a.gui = "bold"
			end
		end

		-- dumb solution
		-- long empty string w/ same color for both fg/bg
		local function null()
			return [[                                                                                                                                                                                                                                                                     ]]
		end

		require("lualine").setup({
			options = {
				icons_enabled = true,
				theme = "kanagawa",
				component_separators = { left = "", right = "" },
				section_separators = { left = "", right = "" },
				disabled_filetypes = {
					statusline = {},
					winbar = {},
				},
				ignore_focus = {},
				always_divide_middle = false,
				globalstatus = true,
				refresh = {
					statusline = 100,
					tabline = 100,
					winbar = 100,
				},
			},
			sections = {
				lualine_a = { { "mode" } },
				lualine_b = { { "filename" } },
				lualine_c = { { "diagnostics" }, { "diff" } },
				lualine_x = {},
				lualine_y = { { "progress" } },
				lualine_z = { { "location" } },
			},
			tabline = {
				lualine_a = {},
				lualine_b = {
					{
						"buffers",
						component_separators = { left = "", right = "" },
						mode = 2,
						icons_enabled = false,
						symbols = {
							modified = " *", -- Text to show when the buffer is modified
							alternate_file = "", -- Text to show to identify the alternate file
							directory = " ", -- Text to show when the buffer is a directory
						},
						buffers_color = {
							-- active = { bg = theme.ui.bg_p1, fg = theme.syn.fun, gui = "italic,bold" },
							-- inactive = { bg = theme.ui.bg_p1, fg = theme.ui.fg_dim },
							active = { bg = "#1F1F28", fg = theme.syn.fun, gui = "italic,bold" },
							inactive = { bg = "#1F1F28", fg = theme.ui.fg_dim },
						},
					},
				},
				lualine_c = { { null, color = { bg = "#1F1F28", fg = "#1F1F28" } } },
				lualine_x = {},
				lualine_y = {
					-- { "diff", color = { bg = theme.ui.bg_p1 } },
					-- { "branch", color = { fg = theme.syn.fun, bg = theme.ui.bg_p1 } },
					{
						"branch",
						color = { bg = "#1F1F28", fg = theme.ui.fg_dim },
						icons_enabled = false,
						-- padding = 2,
					},
				},
				lualine_z = {},
			},
			extensions = {
				-- "neo-tree"
			},
		})
	end,
}
