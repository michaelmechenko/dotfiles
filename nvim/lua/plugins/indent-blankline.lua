return {
	"lukas-reineke/indent-blankline.nvim",
	main = "ibl",
	opts = {},
	config = function()
		require("ibl").setup({
			-- indent = {
			-- 	char = "┊",
			--      -- highlight = "IblIndent"
			-- },
			scope = {
				char = "▏",
				-- highlight = "IblScope"
			},
		})
	end,
}
