-- right click menu

vim.opt.mousemodel = "popup"
vim.api.nvim_del_augroup_by_name('nvim.popupmenu')
vim.cmd([[
  silent! aunmenu PopUp

  anoremenu PopUp.open\ in\ finder                    <Cmd>call jobstart(['open', expand('%:p:h')])<CR>
  anoremenu PopUp.file\ explorer\ (toggle)            <Cmd>Neotree toggle right<CR>
  anoremenu PopUp.copy\ absolute\ path                <Cmd>let @+=expand('%:p')<CR>
  vnoremenu PopUp.copy                                "+y
  anoremenu PopUp.paste                               "+gP
  vnoremenu PopUp.paste                               "+P

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

-- yanking/pasting/cutting to global register
vim.keymap.set("n", "P", '"+p', {})
vim.keymap.set("v", "P", '"+p', {})
vim.keymap.set("n", "Y", '"+y', {})
vim.keymap.set("v", "Y", '"+y', {})
vim.keymap.set("n", "X", '"+x', {})
vim.keymap.set("v", "X", '"+x', {})

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

-- remap escape (snippet-aware: Tab jumps snippet tabstops when active)
-- vim.keymap.set("i", "<Tab>", function()
--   if vim.snippet.active({ direction = 1 }) then
--     return "<Cmd>lua vim.snippet.jump(1)<CR>"
--   end
--   return "<Esc>"
-- end, { expr = true })
-- vim.keymap.set("s", "<Tab>", function()
--   if vim.snippet.active({ direction = 1 }) then
--     return "<Cmd>lua vim.snippet.jump(1)<CR>"
--   end
--   return "<Esc>"
-- end, { expr = true })
-- vim.keymap.set("i", "<S-Tab>", function()
--   if vim.snippet.active({ direction = -1 }) then
--     return "<Cmd>lua vim.snippet.jump(-1)<CR>"
--   end
--   return "<S-Tab>"
-- end, { expr = true })
-- vim.keymap.set("s", "<S-Tab>", function()
--   if vim.snippet.active({ direction = -1 }) then
--     return "<Cmd>lua vim.snippet.jump(-1)<CR>"
--   end
--   return "<S-Tab>"
-- end, { expr = true })
vim.keymap.set("i", "<Tab>", "<Esc>", {})
vim.keymap.set("v", "<Tab>", "<Esc>", {})
-- vim.keymap.set("i", "<C-s>", "<Esc>", {})
-- vim.keymap.set("v", "<C-s>", "<Esc>", {})
vim.keymap.set("i", "<C-v>", '<C-r>0', { noremap = true, silent = true, desc = "Paste yank register" })

-- preview current line in a floating window (useful when wrap is off and line extends past screen)
vim.keymap.set("n", "<leader>pl", function()
  local line = vim.api.nvim_get_current_line()
  local win = vim.api.nvim_get_current_win()
  local text_width = vim.api.nvim_win_get_width(win) - vim.fn.getwininfo(win)[1].textoff
  if vim.fn.strdisplaywidth(line) <= text_width then return end
  local display_width = vim.fn.strdisplaywidth(line)
  local buf = vim.api.nvim_create_buf(false, true)
  vim.api.nvim_buf_set_lines(buf, 0, -1, false, { line })
  local float_width = math.min(display_width + 4, vim.o.columns - 4)
  local float_height = math.ceil(display_width / text_width)
  -- position: below cursor if room, above if not
  local screen_row = vim.fn.winline()
  local rows_below = vim.api.nvim_win_get_height(win) - screen_row
  local row_offset = rows_below >= float_height + 2 and (screen_row) or (screen_row - float_height - 2)
  row_offset = math.max(0, row_offset)
  local col = math.max(0, math.floor((vim.o.columns - float_width) / 2))
  local float_win = vim.api.nvim_open_win(buf, true, {
    relative = "win",
    width = float_width,
    height = float_height,
    row = row_offset,
    col = col,
    style = "minimal",
    border = "rounded",
    zindex = 100,
  })
  vim.wo[float_win].wrap = true
  vim.wo[float_win].linebreak = true
  vim.keymap.set("n", "q", "<cmd>close<cr>", { buffer = buf })
  vim.keymap.set("n", "<Esc>", "<cmd>close<cr>", { buffer = buf })
  vim.api.nvim_create_autocmd("WinLeave", {
    buffer = buf,
    callback = function()
      if vim.api.nvim_win_is_valid(float_win) then vim.api.nvim_win_close(float_win, true) end
    end,
    once = true,
  })
end, { desc = "Preview long line in float" })
