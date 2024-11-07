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
			"",
			"",
			"",
			"notepad",
			"",
			"",
		}

		local buttonhl = function(shortcut, text, command, hl)
			local button = dashboard.button(shortcut, text, command)
			button.opts.hl_shortcut = hl
			return button
		end

		dashboard.section.buttons.val = {
			buttonhl("e", "     >> { new file } ", "<cmd>ene<CR>", "Conceal"),
			buttonhl("ff", "     >> { find files } ", "<cmd>Telescope find_files<CR>", "Conceal"),
			buttonhl("fg", "     >> { live grep } ", "<cmd>Telescope live_grep<CR>", "Conceal"),
			buttonhl("fr", "     >> { recent files } ", "<cmd>Telescope oldfiles<CR>", "Conceal"),
			buttonhl("u", "     >> { update lazy } ", "<cmd>Lazy sync<CR>", "Conceal"),
			buttonhl("l", "     >> { update mason } ", "<cmd>MasonUpdate<CR>", "Conceal"),
			buttonhl("q", "     >> { quit } ", "<cmd>qa<CR>", "Conceal"),
		}
		require("alpha").setup(dashboard.opts)
	end,
}
