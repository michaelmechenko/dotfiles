return {
	{
		"thesimonho/kanagawa-paper.nvim",
		lazy = false,
		priority = 1000,
		opts = {},
		config = function()
			require("kanagawa-paper").setup({
				-- enable undercurls for underlined text
				undercurl = true,
				-- transparent background
				transparent = false,
				-- highlight background for the left gutter
				gutter = false,
				-- background for diagnostic virtual text
				diag_background = true,
				-- dim inactive windows. Disabled when transparent
				dim_inactive = true,
				-- set colors for terminal buffers
				terminal_colors = true,
				-- cache highlights and colors for faster startup.
				-- see Cache section for more details.
				cache = true,

				styles = {
					-- style for comments
					comment = { italic = true },
					-- style for functions
					functions = { italic = false },
					-- style for keywords
					keyword = { italic = false, bold = false },
					-- style for statements
					statement = { italic = false, bold = false },
					-- style for types
					type = { italic = false },
				},
				-- override default palette and theme colors
				colors = {
					palette = {},
					theme = {
						ink = {},
						canvas = {},
					},
				},
				-- adjust overall color balance for each theme [-1, 1]
				color_offset = {
					ink = { brightness = 0, saturation = 0 },
					canvas = { brightness = 0, saturation = 0 },
				},
				-- override highlight groups
				overrides = function(colors)
					return {}
				end,

				-- uses lazy.nvim, if installed, to automatically enable needed plugins
				auto_plugins = true,
				-- enable highlights for all plugins (disabled if using lazy.nvim)
				all_plugins = package.loaded.lazy == nil,
				-- manually enable/disable individual plugins.
				-- check the `groups/plugins` directory for the exact names
				plugins = {
					-- examples:
					-- rainbow_delimiters = true
					-- which_key = false
				},

				-- enable integrations with other applications
			})
			-- vim.cmd.colorscheme("kanagawa-paper-ink")
		end,
	},
}
