return {
	{
		"hrsh7th/cmp-nvim-lsp",
	},
	{
		"L3MON4D3/LuaSnip",
		dependencies = {
			"saadparwaiz1/cmp_luasnip",
			"rafamadriz/friendly-snippets",
		},
		config = function()
			require("luasnip.loaders.from_lua").load({ paths = "~/dotfiles/vim/lua/luasnippets" })
			require("luasnip").config.set_config({
				history = true,
				enable_autosnippets = true,
				updateevents = "TextChanged,TextChangedI",
				delete_check_events = "TextChanged",
				ext_opts = {
					[require("luasnip.util.types").choiceNode] = {
						active = {
							virt_text = { { "↺", "markdownBold" } },
						},
					},
				},
			})
		end,
	},
	{
		"hrsh7th/nvim-cmp",
		config = function()
			local cmp = require("cmp")
			require("luasnip.loaders.from_vscode").lazy_load()
			cmp.setup({
				snippet = {
					expand = function(args)
						require("luasnip").lsp_expand(args.body)
					end,
				},
				window = {
					completion = cmp.config.window.bordered(),
					documentation = cmp.config.window.bordered(),
				},
				experimental = {
					ghost_text = true,
				},
				mapping = cmp.mapping.preset.insert({
					["<C-z>"] = cmp.mapping.scroll_docs(-4),
					["<C-x>"] = cmp.mapping.scroll_docs(4),
					["<C-e>"] = cmp.mapping.confirm({ select = true }),
					["<C-q>"] = cmp.mapping.abort(),
					["<C-s>"] = cmp.mapping(function(fallback)
						if cmp.visible() then
							cmp.select_next_item()
						elseif require("luasnip").locally_jumpable(1) then
							require("luasnip").jump(1)
						else
							fallback()
						end
					end, { "i", "s" }),

					["<C-w>"] = cmp.mapping(function(fallback)
						if cmp.visible() then
							cmp.select_prev_item()
						elseif require("luasnip").locally_jumpable(-1) then
							require("luasnip").jump(-1)
						else
							fallback()
						end
					end, { "i", "s" }),
				}),
				sources = cmp.config.sources({
					-- Other Sources
					{ name = "nvim_lsp", group_index = 1 },
					{ name = "codecompanion", group_index = 1 },
					{ name = "path", group_index = 2 },
					{ name = "luasnip", group_index = 2 },
				}, {
					{ name = "buffer" },
				}),
			})
		end,
	},
}
