vim.cmd([[
    augroup RestoreCursorShapeOnExit
        autocmd!
        autocmd VimLeave * set guicursor=a:hor1
    augroup END
]])

vim.cmd("set notermsync")

vim.opt.fillchars = { eob = " " }
vim.g.mapleader = " "

vim.cmd("set expandtab")
vim.cmd("set tabstop=2")
vim.cmd("set softtabstop=2")
vim.cmd("set shiftwidth=2")

vim.keymap.set("n", "<leader>bd", ":bd<CR>", {})
vim.keymap.set("n", "<leader>bc", ":bprev<CR>", {})
vim.keymap.set("n", "<leader>bv", ":bnext<CR>", {})

vim.opt.number = true
vim.opt.relativenumber = true
vim.opt.signcolumn = "number"
