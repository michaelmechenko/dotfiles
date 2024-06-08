return {
	"folke/drop.nvim",
	event = "VimEnter",
	config = function()
		require("drop").setup({
			---@diagnostic disable-next-line: undefined-doc-name
			---@type DropTheme|string
			theme = "stars",
			ax = 5,
			interval = 400,
      screensaver = 1000 * 60 * 15,
			--filetypes = { "dashboard", "alpha", "starter" },
		})
	end,
}
