vim.cmd([[
    augroup RestoreCursorShapeOnExit
        autocmd!
        autocmd VimLeave * set guicursor=a:hor1
    augroup END
]])

vim.opt.mousemodel = "popup"
vim.api.nvim_del_augroup_by_name('nvim.popupmenu')
vim.cmd([[
  silent! aunmenu PopUp

  anoremenu PopUp.file\ explorer\ (toggle)            <Cmd>Neotree toggle right<CR>
  vnoremenu PopUp.copy                                "+y
  anoremenu PopUp.paste                               "+gP
  vnoremenu PopUp.paste                               "+P
  anoremenu PopUp.copy\ absolute\ path                <Cmd>let @+=expand('%:p')<CR>

  anoremenu PopUp.-1-                                 <Nop>

  " Buffer operations
  anoremenu PopUp.buffer:\ create\ new                <Cmd>enew<CR>
  anoremenu PopUp.buffer:\ goto\ next                 <Cmd>bnext<CR>
  anoremenu PopUp.buffer:\ goto\ prev                 <Cmd>bprev<CR>
  anoremenu PopUp.buffer:\ delete                     <Cmd>bdelete<CR>

  anoremenu PopUp.-2-                                 <Nop>

  " LSP operations
  anoremenu PopUp.lsp:\ format                        <Cmd>lua vim.lsp.buf.format()<CR>
  anoremenu PopUp.lsp:\ hover                         <Cmd>lua vim.lsp.buf.hover()<CR>
  anoremenu PopUp.lsp:\ goto\ definition              <Cmd>lua vim.lsp.buf.definition()<CR>
  anoremenu PopUp.lsp:\ goto\ declaration             <Cmd>lua vim.lsp.buf.declaration()<CR>
  anoremenu PopUp.lsp:\ goto\ implementation          <Cmd>lua vim.lsp.buf.implementation()<CR>
  anoremenu PopUp.lsp:\ show\ signature               <Cmd>lua vim.lsp.buf.signature_help()<CR>
]])

vim.cmd("set notermsync")
vim.cmd("set noswapfile")
vim.opt.fillchars = { eob = " " }
vim.g.mapleader = " "

vim.cmd("set expandtab")
vim.cmd("set tabstop=2")
vim.cmd("set softtabstop=2")
vim.cmd("set shiftwidth=2")

-- yanking/pasting to global register
vim.keymap.set("n", "P", '"+p', {})
vim.keymap.set("n", "Y", '"+y', {})
vim.keymap.set("v", "P", '"+p', {})
vim.keymap.set("v", "Y", '"+y', {})

vim.api.nvim_set_keymap('n', 'p', '"0p', { noremap = true })
-- vim.api.nvim_set_keymap('n', 'P', '"0P', { noremap = true })
vim.api.nvim_set_keymap('v', 'p', '"0p', { noremap = true })
-- vim.api.nvim_set_keymap('v', 'P', '"0P', { noremap = true })

-- buffer remaps
-- vim.keymap.set("n", "<leader>bd", "<CR>:bd<CR>", {})
-- vim.keymap.set("n", "<leader>bc", "<CR>:bprev<CR>", {})
-- vim.keymap.set("n", "<leader>bv", "<CR>:bnext<CR>", {})

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
--
vim.keymap.set("i", "<C-v>", '<C-r>0', { noremap = true, silent = true, desc = "Paste yank register" })

vim.opt.number = true
vim.opt.relativenumber = true
vim.opt.signcolumn = "number"
