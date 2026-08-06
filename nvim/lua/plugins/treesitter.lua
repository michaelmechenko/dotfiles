return {
  {
    "nvim-treesitter/nvim-treesitter",
    branch = "main",
    build = ":TSUpdate",
    main = "nvim-treesitter",
    init = function()
      local ensure_installed = {
        "c",
        "lua",
        "vim",
        "vimdoc",
        "javascript",
        "html",
        "css",
        "cmake",
        "csv",
        "cpp",
        "git_config",
        "git_rebase",
        "gitcommit",
        "gitignore",
        "gitattributes",
        "go",
        "http",
        "java",
        "make",
        "python",
        "regex",
        "rust",
        "sql",
        "ssh_config",
        "svelte",
        "tsx",
        "typescript",
        "markdown",
        "latex",
        "xml",
        "yaml",
        -- shell + config filetypes. No "jsonc"/"tmux"/"ghostty"/"conf" parsers exist on
        -- the main branch: jsonc reuses the json parser via the plugin's own filetype
        -- registration, the rest stay on vim's regex syntax.
        "bash",
        "zsh",
        "json",
        "toml",
        "ini",
        "diff",
        "dockerfile",
        "nix",
        "perl",
        "hcl",
        "terraform",
        "scss",
      }
      local installed = require("nvim-treesitter.config").get_installed()
      local missing = vim.iter(ensure_installed)
        :filter(function(p) return not vim.tbl_contains(installed, p) end)
        :totable()
      if #missing > 0 then
        require("nvim-treesitter").install(missing)
      end

      -- Enable treesitter highlight and indent for all filetypes
      vim.api.nvim_create_autocmd("FileType", {
        callback = function(ev)
          local lang = vim.treesitter.language.get_lang(ev.match)
          -- A parser alone is NOT enough to hand over from vim's regex syntax.
          -- vim.treesitter.start() asserts only that a parser resolves; with no
          -- highlights query it still blanks 'syntax' and attaches a highlighter that
          -- yields zero captures, and it does NOT error -- so pcall() can't detect the
          -- failure. Require the query first, so a parser-without-queries (e.g. a stale
          -- master-branch .so) degrades to regex syntax instead of to nothing at all.
          if not (lang and vim.treesitter.query.get(lang, "highlights")) then
            return
          end
          if pcall(vim.treesitter.start, ev.buf, lang) then
            vim.bo[ev.buf].indentexpr = "v:lua.require'nvim-treesitter'.indentexpr()"
          end
        end,
      })
    end,
  },
  {
    "nvim-treesitter/nvim-treesitter-textobjects",
    branch = "main",
    init = function()
      vim.g.no_plugin_maps = true
    end,
    config = function()
      require("nvim-treesitter-textobjects").setup {
        move = {
          set_jumps = true,
        },
      }
    end,
  }
}
