return {
	"goolord/alpha-nvim",
	dependencies = {
		"nvim-tree/nvim-web-devicons",
		"nvim-lua/plenary.nvim",
	},
	config = function()
		local dashboard = require("alpha.themes.dashboard")
		dashboard.section.header.val = {
			"",
			"notepad",
			"",
		}

		local buttonhl = function(shortcut, text, command, hl, position)
			local button = dashboard.button(shortcut, text, command)
			button.opts.hl_shortcut = hl
			button.opts.position = position
			return button
		end

		dashboard.section.buttons.val = {
			buttonhl("n", "     ‹ new file ›", "<cmd>ene<CR>", "Constant", "center"),
			buttonhl(
				"re",
				"     ‹ filetree ›",
				"<cmd>Neotree filesystem reveal right<CR>:set relativenumber<CR>",
				"Constant",
				"center"
			),
			buttonhl("fe", "     ‹ find files ›", "<cmd>Telescope find_files<CR>", "Constant", "center"),
			buttonhl("fg", "     ‹ live grep ›", "<cmd>Telescope live_grep<CR>", "Constant", "center"),
			buttonhl("fr", "     ‹ recent files ›", "<cmd>Telescope oldfiles<CR>", "Constant", "center"),
			buttonhl("l", "     ‹ lazy ›", "<cmd>Lazy<CR>", "Constant", "center"),
			buttonhl("m", "     ‹ mason ›", "<cmd>Mason<CR>", "Constant", "center"),
			buttonhl("q", "     ‹ quit ›", "<cmd>qa<CR>", "Constant", "center"),
		}

		vim.api.nvim_create_autocmd("User", {
			pattern = "AlphaReady",
			command = [[set relativenumber]],
		})

		require("alpha").setup(dashboard.opts)
	end,
}
