return {
	{
		"MeanderingProgrammer/render-markdown.nvim",
		-- dependencies = { "nvim-treesitter/nvim-treesitter", "echasnovski/mini.nvim" }, -- if you use the mini.nvim suite
		dependencies = { "nvim-treesitter/nvim-treesitter", "echasnovski/mini.icons" }, -- if you use standalone mini plugins
		-- dependencies = { 'nvim-treesitter/nvim-treesitter', 'nvim-tree/nvim-web-devicons' }, -- if you prefer nvim-web-devicons
		---@module 'render-markdown'
		---@type render.md.UserConfig
		opts = {},
		ft = { "markdown", "codecompanion" },
		config = function()
			require("render-markdown").setup({
				heading = { sign = true, icons = { "- ", "- ", "- ", "- ", "- ", "- " }, position = "inline" },
				latex = {
					enabled = true,
					converter = "latex2text",
					highlight = "RenderMarkdownMath",
					top_pad = 0,
					bottom_pad = 0,
				},
			})
		end,
	},
}
