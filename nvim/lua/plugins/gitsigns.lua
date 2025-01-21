return {
	{
		"lewis6991/gitsigns.nvim",
		config = function()
			-- require("scrollbar.handlers.gitsigns").setup()
			require("gitsigns").setup({
				signcolumn = false, -- Toggle with `:Gitsigns toggle_signs`
			})
		end,
	},
}
