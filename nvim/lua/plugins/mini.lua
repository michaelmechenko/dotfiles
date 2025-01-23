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
					-- Width of focused window
					width_focus = 50,
					-- Width of non-focused window
					width_nofocus = 50,
					-- Width of preview window
					width_preview = 25,
				},
			})
			vim.api.nvim_create_autocmd("User", {
				pattern = "MiniFilesBufferUpdate",
				command = [[set relativenumber]],
			})
			vim.api.nvim_create_autocmd("User", {
				pattern = "MiniFilesExplorerOpen",
				command = [[set relativenumber]],
			})
			vim.api.nvim_create_autocmd("User", {
				pattern = "MiniFilesWindowOpen",
				command = [[set relativenumber]],
			})
		end,
	},
}
