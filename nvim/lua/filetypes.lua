-- Filetype overrides for config files this repo owns whose names defeat nvim's
-- built-in detection.
vim.filetype.add({
  filename = {
    -- bash scripts with no shebang; the *rc name pattern otherwise wins them for `conf`
    ["sketchybarrc"] = "bash",
    ["sketchybarrc.full"] = "bash",
    ["sketchybarrc.performance"] = "bash",
  },
  pattern = {
    -- Mirrors Ghostty's own ftdetect/ghostty.vim, which never gets sourced: nvim reads
    -- ftdetect/*.vim before lazy.nvim amends runtimepath. See init.lua's rtp.paths.
    [".*/ghostty/config"] = "ghostty",
    [".*/ghostty/themes/.*"] = "ghostty",
  },
})
