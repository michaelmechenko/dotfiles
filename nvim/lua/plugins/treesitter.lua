return {
	"nvim-treesitter/nvim-treesitter",
	build = ":TSUpdate",
	config = function()
		local configs = require("nvim-treesitter.configs")

		configs.setup({
			ensure_installed = {
				"c",
				"lua",
				"vim",
				"vimdoc",
				"javascript",
				"html",
				"css",
				"cmake",
				"asm",
				"csv",
				"cpp",
				"arduino",
				"func",
				"git_config",
				"git_rebase",
				"gitcommit",
				"gitignore",
				"gitattributes",
				"go",
				"http",
				"java",
				"make",
				"python",
				"regex",
				"rust",
				"scss",
				"sql",
				"ssh_config",
				"svelte",
				"tsx",
				"typescript",
				"typespec",
				"typoscript",
        "markdown",
        "markdown_inline",
        "latex",
				"xml",
				"yaml",
			},
			auto_install = true,
			sync_install = true,
			highlight = { enable = true },
			indent = { enable = true },
		})
	end,
}
