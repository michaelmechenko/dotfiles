return {
	{
		"echasnovski/mini.icons",
		version = false,
		config = function()
			require("mini.icons").setup()
		end,
	},
	{
		"echasnovski/mini.files",
		version = false,
		config = function()
			require("mini.files").setup({
				mappings = {
					go_in_plus = "e",
				},
				windows = {
					preview = false,
				},
			})
		end,
	},
}
