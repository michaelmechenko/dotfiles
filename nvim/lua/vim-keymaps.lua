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

-- buffer remaps
vim.keymap.set("n", "<leader>bd", ":bd<CR>", {})
vim.keymap.set("n", "<leader>bc", ":bprev<CR>", {})
vim.keymap.set("n", "<leader>bv", ":bnext<CR>", {})

-- vertical navigation
-- vim.keymap.set("n", "{", "<C-u>zz", {})
-- vim.keymap.set("n", "}", "<C-d>zz", {})
vim.keymap.set("n", "{", "10kzz", {})
vim.keymap.set("n", "}", "10jzz", {})
vim.keymap.set("n", "=", "}", {})
vim.keymap.set("n", "-", "{", {})

-- searching
vim.keymap.set("n", "n", "nzzzv", {})
vim.keymap.set("n", "N", "Nzzzv", {})

-- create new line below in normal mode
vim.keymap.set("n", "O", "o<C-[>k", {})

-- delete line below
vim.keymap.set("n", "Z", "jddk", {})

vim.opt.number = true
vim.opt.relativenumber = true
vim.opt.signcolumn = "number"
