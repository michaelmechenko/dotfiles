vim.cmd([[
    augroup RestoreCursorShapeOnExit
        autocmd!
        autocmd VimLeave * set guicursor=a:hor1
    augroup END
]])

-- vim.cmd([[
--   aunmenu PopUp
--   autocmd! nvim.popupmenu
-- ]])

vim.cmd("set notermsync")
vim.cmd("set noswapfile")
vim.opt.fillchars = { eob = " " }
vim.g.mapleader = " "

vim.cmd("set expandtab")
vim.cmd("set tabstop=2")
vim.cmd("set softtabstop=2")
vim.cmd("set shiftwidth=2")


vim.keymap.set("n", '<C-k>', function() vim.lsp.buf.signature_help() end, {})
vim.keymap.set("i", '<C-l>', function() vim.lsp.buf.signature_help() end, {})
vim.lsp.handlers['textDocument/signatureHelp'] = vim.lsp.with(
  vim.lsp.handlers['signature_help'], {
    border = 'single',
    close_events = { "CursorMoved", "BufHidden", "InsertCharPre" },
  }
)

-- yanking/pasting to global register
vim.keymap.set("n", "P", '"+p', {})
vim.keymap.set("n", "Y", '"+y', {})
vim.keymap.set("v", "P", '"+p', {})
vim.keymap.set("v", "Y", '"+y', {})

-- buffer remaps
vim.keymap.set("n", "<leader>bd", "<CR>:bd<CR>", {})
vim.keymap.set("n", "<leader>bc", "<CR>:bprev<CR>", {})
vim.keymap.set("n", "<leader>bv", "<CR>:bnext<CR>", {})

-- window management
vim.keymap.set("n", "<leader>we", "<C-w>=", {})
vim.keymap.set("n", "<leader>w/", "2<C-w>+", {})
vim.keymap.set("n", "<leader>w.", "2<C-w>-", {})
vim.keymap.set("n", "<leader>w,", "5<C-w>>", {})
vim.keymap.set("n", "<leader>wm", "5<C-w><", {})

-- vertical navigation
-- vim.keymap.set("n", "{", "<C-u>", {})
-- vim.keymap.set("n", "{", "<C-u>", {})
-- vim.keymap.set("v", "}", "<C-d>", {})
-- vim.keymap.set("v", "}", "<C-d>", {})
vim.keymap.set("n", "{", "15k", {})
vim.keymap.set("n", "}", "15j", {})
vim.keymap.set("v", "{", "10k", {})
vim.keymap.set("v", "}", "10j", {})
vim.keymap.set("n", "=", "}", {})
vim.keymap.set("n", "-", "{", {})
vim.keymap.set("v", "=", "}", {})
vim.keymap.set("v", "-", "{", {})

-- searching
vim.keymap.set("n", "n", "nzzzv", {})
vim.keymap.set("n", "N", "Nzzzv", {})

-- create new line below in normal mode
vim.keymap.set("n", "O", "o<C-[>k", {})

-- delete line below
vim.keymap.set("n", "Z", "jddk", {})

-- remap escape
vim.keymap.set("i", "<Tab>", "<Esc>", {})
vim.keymap.set("v", "<Tab>", "<Esc>", {})
-- vim.keymap.set("i", "<C-s>", "<Esc>", {})
-- vim.keymap.set("v", "<C-s>", "<Esc>", {})

vim.opt.number = true
vim.opt.relativenumber = true
vim.opt.signcolumn = "number"
