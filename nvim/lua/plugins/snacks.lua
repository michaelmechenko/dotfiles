require("kanagawa").load("wave")

return {
	{
		"folke/snacks.nvim",
		priority = 1000,
		lazy = false,
		opts = {
			-- your configuration comes here
			-- or leave it empty to use the default settings
			-- refer to the configuration section below
			bigfile = { enabled = true },
			-- notifier = { enabled = true },
			quickfile = { enabled = true },
			-- statuscolumn = { enabled = true },
			-- words = { enabled = true },
			terminal = {},
			dim = {
				{
					scope = {
						min_size = 5,
						max_size = 20,
						siblings = true,
					},
					animate = {
						enabled = vim.fn.has("nvim-0.10") == 1,
						easing = "outQuad",
						duration = {
							step = 10, -- ms per step
							total = 200, -- maximum duration
						},
					},
					-- what buffers to dim
					filter = function(buf)
						return vim.g.snacks_dim ~= false
							and vim.b[buf].snacks_dim ~= false
							and vim.bo[buf].buftype == ""
					end,
				},
			},
			indent = {
				{
					priority = 1,
					enabled = true, -- enable indent guides
					-- char = "│",
					char = "▎",
					blank = nil, ---@type string? blank space character. If nil, it will use listchars when list is enabled.
					-- blank = "∙",
					only_scope = true, -- only show indent guides of the scope
					only_current = true, -- only show indent guides in the current window
					hl = "SnacksIndentBlank", ---@type string|string[] hl groups for indent guides
				},
				animate = {
					-- enabled = vim.fn.has("nvim-0.10") == 1,
					enabled = false,
					style = "up_down",
					easing = "linear",
					duration = {
						step = 12, -- ms per step
						total = 100, -- maximum duration
					},
				},
				scope = {
					enabled = true, -- enable highlighting the current scope
					priority = 200,
					-- char = "│",
					char = "▎",
					underline = false, -- underline the start of the scope
					only_current = false, -- only show scope in the current window
					hl = "MoreMsg",
				},
				chunk = {
					-- when enabled, scopes will be rendered as chunks, except for the
					-- top-level scope which will be rendered as a scope.
					enabled = false,
					-- only show chunk scopes in the current window
					only_current = false,
					priority = 200,
					hl = "SnacksIndentBlank",
				},
				-- filter for buffers to enable indent guides
				filter = function(buf)
				  return vim.g.snacks_indent ~= false
				      and vim.b[buf].snacks_indent ~= false
				      and vim.bo[buf].buftype == ""
				end,
			},
		},
	},
}
