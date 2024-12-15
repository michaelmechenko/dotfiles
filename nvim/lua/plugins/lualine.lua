local function kanagawa_theme()
	local theme = require("kanagawa.colors").setup().theme
	local kanagawa = {}

	kanagawa.normal = {
		a = { bg = theme.syn.fun, fg = theme.ui.bg_m3 },
		b = { bg = nil, fg = theme.syn.fun },
		c = { bg = nil, theme.ui.bg, fg = theme.ui.fg },
	}

	kanagawa.insert = {
		a = { bg = theme.diag.ok, fg = theme.ui.bg },
		b = { bg = theme.ui.bg, fg = theme.diag.ok },
	}

	kanagawa.command = {
		a = { bg = theme.syn.operator, fg = theme.ui.bg },
		b = { bg = theme.ui.bg, fg = theme.syn.operator },
	}

	kanagawa.visual = {
		a = { bg = theme.syn.keyword, fg = theme.ui.bg },
		b = { bg = theme.ui.bg, fg = theme.syn.keyword },
	}

	kanagawa.replace = {
		a = { bg = theme.syn.constant, fg = theme.ui.bg },
		b = { bg = theme.ui.bg, fg = theme.syn.constant },
	}

	kanagawa.inactive = {
		a = { bg = theme.ui.bg_m3, fg = theme.ui.fg_dim },
		b = { bg = theme.ui.bg_m3, fg = theme.ui.fg_dim, gui = "bold" },
		c = { bg = theme.ui.bg_p1, fg = theme.ui.fg_dim },
	}

	if vim.g.kanagawa_lualine_bold then
		for _, mode in pairs(kanagawa) do
			mode.a.gui = "bold"
		end
	end

	return kanagawa
end

return {
	"nvim-lualine/lualine.nvim",
	dependencies = { "nvim-tree/nvim-web-devicons" },
	config = function()
		require("lualine").setup({
			options = {
				icons_enabled = true,
				theme = kanagawa_theme,
				component_separators = { left = "", right = "" },
				section_separators = { left = "", right = "" },
				ignore_focus = {},
				always_divide_middle = true,
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
				lualine_c = {
					{ "diagnostics" },
				},
				lualine_x = {
					{ "diff" },
				},
				lualine_y = { { "progress" } },
				lualine_z = { { "location" } },
			},
			tabline = {
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
							active = { bg = "None", fg = "#9CABCA", gui = "italic,bold" },
							inactive = { bg = "None", fg = "#57576b" },
						},
						filetype_names = {
							TelescopePrompt = "file explorer",
							fzf = "fuzzy",
							alpha = "home",
						},
					},
				},
				lualine_y = {
					{
						"branch",
						color = { bg = "None", fg = "#57576b" },
						icons_enabled = false,
					},
				},
			},
			extensions = {
				-- "neo-tree"
			},
		})
	end,
}
