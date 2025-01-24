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
			buttonhl("n", "     ‹ new file ›", "<cmd>ene<CR>", "Conceal", "center"),
			buttonhl(
				"re",
				"     ‹ filetree ›",
				"<cmd>Neotree filesystem reveal right<CR>:set relativenumber<CR>",
				"Conceal",
				"center"
			),
			buttonhl("fe", "     ‹ find files ›", "<cmd>Telescope find_files<CR>", "Conceal", "center"),
			buttonhl("fg", "     ‹ live grep ›", "<cmd>Telescope live_grep<CR>", "Conceal", "center"),
			buttonhl("fr", "     ‹ recent files ›", "<cmd>Telescope oldfiles<CR>", "Conceal", "center"),
			buttonhl("l", "     ‹ lazy ›", "<cmd>Lazy<CR>", "Conceal", "center"),
			buttonhl("m", "     ‹ mason ›", "<cmd>Mason<CR>", "Conceal", "center"),
			buttonhl("q", "     ‹ quit ›", "<cmd>qa<CR>", "Conceal", "center"),
		}

		vim.api.nvim_create_autocmd("User", {
			pattern = "AlphaReady",
			command = [[set relativenumber]],
		})

		require("alpha").setup(dashboard.opts)
	end,
}
