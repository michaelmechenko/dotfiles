return {
	"nvim-lualine/lualine.nvim",
	dependencies = { "nvim-tree/nvim-web-devicons" },
	config = function()
		require("lualine").setup({
			options = {
				icons_enabled = true,
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
				lualine_b = {
					{
						"buffers",
						show_filename_only = true, -- Shows shortened relative path when set to false.
						hide_filename_extension = false, -- Hide filename extension when set to true.
						show_modified_status = true, -- Shows indicator when the buffer is modified.

						mode = 2, -- 0: Shows buffer name
						-- 1: Shows buffer index
						-- 2: Shows buffer name + buffer index
						-- 3: Shows buffer number
						-- 4: Shows buffer name + buffer number

						max_length = vim.o.columns * 2 / 3, -- Maximum width of buffers component,
						-- it can also be a function that returns
						-- the value of `max_length` dynamically.

						component_separators = { left = "", right = "" },
						icons_enabled = false,
						symbols = {
							modified = " *", -- Text to show when the buffer is modified
							alternate_file = "", -- Text to show to identify the alternate file
							directory = " ", -- Text to show when the buffer is a directory
						},
						buffers_color = {
							active = {
								bg = "None", --[[ fg = "#9CABCA", ]]
								gui = "italic,bold",
							},
							inactive = { bg = "None", fg = "#57576b" },
						},
						filetype_names = {
							TelescopePrompt = "file explorer",
							fzf = "fuzzy",
							alpha = "home",
						},
					},
				},
				lualine_c = {},
				lualine_y = {},
				lualine_x = {
					{ "diagnostics", "diff" },
				},
				-- lualine_z = {},
				-- lualine_x = {
				-- 	{ "diagnostics", "diff" },
				-- },
				-- lualine_y = { { "location" } },
				lualine_z = { { "progress" } },
			},
			-- tabline = {
			-- 	lualine_b = {
			-- 		{
			-- 			"buffers",
			-- 			component_separators = { left = "", right = "" },
			-- 			mode = 2,
			-- 			icons_enabled = false,
			-- 			symbols = {
			-- 				modified = " *", -- Text to show when the buffer is modified
			-- 				alternate_file = "", -- Text to show to identify the alternate file
			-- 				directory = " ", -- Text to show when the buffer is a directory
			-- 			},
			-- 			buffers_color = {
			-- 				active = {
			-- 					bg = "None", --[[ fg = "#9CABCA", ]]
			-- 					gui = "italic,bold",
			-- 				},
			-- 				inactive = { bg = "None", fg = "#57576b" },
			-- 			},
			-- 			filetype_names = {
			-- 				TelescopePrompt = "file explorer",
			-- 				fzf = "fuzzy",
			-- 				alpha = "home",
			-- 			},
			-- 		},
			-- 	},
			-- 	lualine_c = {
			-- 		{
			-- 			color = { bg = "None", fg = "#57576b" },
			-- 		},
			-- 	},
			-- 	lualine_x = {
			-- 		{
			-- 			color = { bg = "None", fg = "#57576b" },
			-- 		},
			-- 	},
			-- 	lualine_y = {
			-- 		{
			-- 			"branch",
			-- 			color = { bg = "None", fg = "#57576b" },
			-- 			icons_enabled = false,
			-- 		},
			-- 	},
			-- },
			extensions = {
				-- "neo-tree"
			},
		})
	end,
}
