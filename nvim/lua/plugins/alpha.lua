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
			"███▄▄▄▄      ▄████████  ▄██████▄   ▄█    █▄   ▄█    ▄▄▄▄███▄▄▄▄   ",
			"███▀▀▀██▄   ███    ███ ███    ███ ███    ███ ███  ▄██▀▀▀███▀▀▀██▄ ",
			"███   ███   ███    █▀  ███    ███ ███    ███ ███▌ ███   ███   ███ ",
			"███   ███  ▄███▄▄▄     ███    ███ ███    ███ ███▌ ███   ███   ███ ",
			"███   ███ ▀▀███▀▀▀     ███    ███ ███    ███ ███▌ ███   ███   ███ ",
			"███   ███   ███    █▄  ███    ███ ███    ███ ███  ███   ███   ███ ",
			"███   ███   ███    ███ ███    ███ ███    ███ ███  ███   ███   ███ ",
			" ▀█   █▀    ██████████  ▀██████▀   ▀██████▀  █▀    ▀█   ███   █▀  ",
			"",
			"",
		}
		dashboard.section.buttons.val = {
			dashboard.button("e", " > new file", "<cmd>ene<CR>"),
			dashboard.button("<leader> ff", "󰱼 > find files", "<cmd>Telescope find_files<CR>"),
			dashboard.button("<leader> fd", "󰊄 > live grep"),
			dashboard.button("<leader> fr", " > recent files", "<cmd>Telescope oldfiles<CR>"),
			--			dashboard.button("c", " > config", "<cmd>cd ~/.config/nvim/ <CR>"),
			dashboard.button("u", " > update plugins", "<cmd>Lazy sync<CR>"),
			dashboard.button("q", "󰅚 > quit", "<cmd>qa<CR>"),
		}
		require("alpha").setup(dashboard.opts)
	end,
}
