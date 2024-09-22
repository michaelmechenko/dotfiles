return {
	"lukas-reineke/indent-blankline.nvim",
	event = "VeryLazy",
	main = "ibl",
	opts = {},
	config = function()
		require("ibl").setup({
			indent = {
				-- char = "┊",
				char = " ",
				--      -- highlight = "IblIndent"
			},
			scope = {
				char = "▎",
				-- char = " ",
				-- highlight = "IblScope"
			},
		})
	end,
}
