-- Installed native colorschemes. Only oldworld is eagerly loaded; Lazy loads an
-- alternate when :colorscheme requests it through theme-selector.
return {
  { "TheNiteCoder/mountaineer.vim", lazy = true },
  { "casedami/neomodern.nvim", lazy = true },
  { "daedlock/matugen.nvim", lazy = true },
  { "EdenEast/nightfox.nvim", lazy = true },
  { "sainnhe/everforest", lazy = true },
  { "loctvl842/monokai-pro.nvim", lazy = true },
  { "thesimonho/kanagawa-paper.nvim", lazy = true },
  { "WTFox/jellybeans.nvim", lazy = true },
  { "kvrohit/substrata.nvim", lazy = true },
  { "mellow-theme/mellow.nvim", lazy = true },
  { "rose-pine/neovim", name = "rose-pine", lazy = true },
  { "savq/melange-nvim", lazy = true },
  { "oskarnurm/koda.nvim", lazy = true },
}
