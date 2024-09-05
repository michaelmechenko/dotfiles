return {
	{
		"williamboman/mason.nvim",
		event = "VeryLazy",
		config = function()
			require("mason").setup()
		end,
	},
	{
		"williamboman/mason-lspconfig.nvim",
		event = "VeryLazy",
		config = function()
			require("mason-lspconfig").setup({
				ensure_installed = {
					"lua_ls",
					"rust_analyzer",
					"clangd",
					"cmake",
					"cssls",
					"dockerls",
					"gopls",
					"html",
					"biome",
					"markdown_oxide",
					"pyright",
					"svelte",
					"tailwindcss",
					"lemminx",
				},
			})
		end,
	},
	{
		"neovim/nvim-lspconfig",
		event = "VeryLazy",
		config = function()
			local lspconfig = require("lspconfig")
			lspconfig.lua_ls.setup({})
			lspconfig.rust_analyzer.setup({})
			lspconfig.clangd.setup({})
			lspconfig.cmake.setup({})
			lspconfig.dockerls.setup({})
			-- lspconfig.eslint.setup({})
			lspconfig.gopls.setup({})
			lspconfig.html.setup({})
			lspconfig.biome.setup({})
			lspconfig.markdown_oxide.setup({})
			lspconfig.pyright.setup({})
			lspconfig.svelte.setup({})
			lspconfig.tailwindcss.setup({})
			lspconfig.lemminx.setup({})
			lspconfig.ccls.setup({
				init_options = {
					compilationDatabaseDirectory = "build",
					index = {
						threads = 0,
					},
					clang = {
						excludeArgs = { "-frounding-math" },
					},
				},
			})
		end,
	},
}
