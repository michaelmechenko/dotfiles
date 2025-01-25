return {
  {
    "rmagatti/auto-session",
    lazy = false,

    ---enables autocomplete for opts
    ---@module "auto-session"
    ---@type AutoSession.Config
    opts = {
      suppressed_dirs = {
        "~/",
        "~/.config",
        "~/_main",
        "~/Downloads",
        "~/_main/vault_classwork",
        "~/_main/vault_general",
      },
      -- log_level = 'debug',
      auto_save = true,
      auto_restore = false,
      session_lens = {
        previewer = false, -- File preview for session picker

        mappings = {
          -- Mode can be a string or a table, e.g. {"i", "n"} for both insert and normal mode
          delete_session = { "i", "<C-D>" },
          alternate_session = { "i", "<C-S>" },
          copy_session = { "i", "<C-Y>" },
        },
      },
    },
  },
}
