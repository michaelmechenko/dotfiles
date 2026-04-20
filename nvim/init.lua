local lazypath = vim.fn.stdpath("data") .. "/lazy/lazy.nvim"
if not (vim.uv or vim.loop).fs_stat(lazypath) then
  vim.fn.system({
    "git",
    "clone",
    "--filter=blob:none",
    "https://github.com/folke/lazy.nvim.git",
    "--branch=stable",
    lazypath,
  })
end

vim.opt.rtp:prepend(lazypath)
vim.opt.termguicolors = true
vim.opt.cursorline = true
vim.opt.conceallevel = 0
vim.o.winborder = "rounded"

vim.opt.number = true
vim.opt.relativenumber = true
vim.opt.signcolumn = "number"

vim.cmd("set notermsync")
vim.cmd("set noswapfile")
vim.opt.fillchars = { eob = " " }
vim.g.mapleader = " "

vim.cmd("set expandtab")
vim.cmd("set tabstop=2")
vim.cmd("set softtabstop=2")
vim.cmd("set shiftwidth=2")

-- Native completion (0.12)
-- vim.o.completeopt = "menu,popup,noinsert"
-- vim.o.complete = ".,w,b"
-- vim.o.autocomplete = true
-- vim.o.autocompletedelay = 0
-- vim.o.pumheight = 6
-- vim.o.pummaxwidth = 45
-- vim.o.pumborder = "none"
-- vim.o.pumblend = 25
-- vim.o.completeitemalign = "abbr,kind,menu"

-- LspAttach: enable completion, remove default CTRL-S, set completion keymaps
-- vim.api.nvim_create_autocmd("LspAttach", {
--   group = vim.api.nvim_create_augroup("lsp.completion", { clear = true }),
--   callback = function(ev)
--     local client = vim.lsp.get_client_by_id(ev.data.client_id)
--     if not client then return end
--     pcall(vim.keymap.del, "i", "<C-S>", { buffer = ev.buf })
--
--     -- Completion keymaps (buffer-local to override LSP defaults)
--     vim.keymap.set("i", "<C-e>", function()
--       if vim.fn.pumvisible() == 1 then return "<C-y>" end
--       return "<C-e>"
--     end, { buffer = ev.buf, expr = true, desc = "Accept completion" })
--
--     vim.keymap.set("i", "<C-q>", function()
--       if vim.fn.pumvisible() == 1 then return "<C-e>" end
--       return "<C-q>"
--     end, { buffer = ev.buf, expr = true, desc = "Dismiss completion" })
--
--     vim.keymap.set("i", "<C-s>", function()
--       if vim.fn.pumvisible() == 1 then return "<C-n>" end
--       return "<C-s>"
--     end, { buffer = ev.buf, expr = true, desc = "Next completion item" })
--
--     vim.keymap.set("i", "<C-w>", function()
--       if vim.fn.pumvisible() == 1 then return "<C-p>" end
--       return "<C-w>"
--     end, { buffer = ev.buf, expr = true, desc = "Previous completion item" })
--
--     if client:supports_method("textDocument/completion") then
--       vim.lsp.completion.enable(true, client.id, ev.buf, { autotrigger = true })
--     end
--   end,
-- })

vim.api.nvim_create_autocmd("LspAttach", {
  group = vim.api.nvim_create_augroup("blink.ctrl_s", { clear = true }),
  callback = function(ev)
    pcall(vim.keymap.del, "i", "<C-s>", { buffer = ev.buf })
  end,
})

vim.opt.wrap = true
vim.opt.linebreak = true

vim.opt.autoread = true
vim.api.nvim_create_autocmd({ "BufEnter", "CursorHold", "CursorHoldI", "FocusGained" }, {
  command = "if mode() != 'c' | checktime | endif",
  pattern = { "*" },
})

-- semantic tokens >> treesitter
vim.highlight.priorities.semantic_tokens = 95

vim.diagnostic.config({
  virtual_text = true,
  signs = true,
  underline = true,
})

require("vim-keymaps")
require("lazy").setup("plugins")
