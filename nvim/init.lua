local lazypath = vim.fn.stdpath("data") .. "/lazy/lazy.nvim"
if not (vim.uv or vim.loop).fs_stat(lazypath) then
  vim.fn.system({
    "git",
    "clone",
    "--filter=blob:none",
    "https://github.com/folke/lazy.nvim.git",
    "--branch=stable", -- latest stable release
    lazypath,
  })
end

vim.g.vimtex_quickfix_enabled = 0
vim.g.vimtex_syntax_conceal_disable = true

vim.opt.rtp:prepend(lazypath)
vim.opt.termguicolors = true
vim.opt.cursorline = true
vim.opt.conceallevel = 0

	vim.diagnostic.config({
		virtual_text = true,
		signs = true,
		underline = true,
	})

require("vim-keymaps")
require("lazy").setup("plugins")
