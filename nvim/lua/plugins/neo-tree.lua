return {
  "nvim-neo-tree/neo-tree.nvim",
  event = "VeryLazy",
  branch = "v3.x",
  dependencies = {
    "nvim-lua/plenary.nvim",
    "nvim-tree/nvim-web-devicons", -- not strictly required, but recommended
    "MunifTanjim/nui.nvim",
    -- "3rd/image.nvim", -- Optional image support in preview window: See `# Preview Mode` for more information
  },
  lazy = false,
  config = function()
    require("neo-tree").setup({
      source_selector = {
        winbar = true,
        statusline = false,
      },
      popup_border_style = "single",
      sources = {
        "filesystem",
        "buffers",
        "git_status",
        -- "document_symbols",
      },
      close_if_last_window = false,
      window = {
        position = "right",
        mappings = {
          ["P"] = {
            "toggle_preview",
            config = {
              use_float = true,
              use_snacks_image = false,
              use_image_nvim = false,
              title = "preview window",
            }
          },
          ["e"] = "open",
        },
      },
      event_handlers = {
        {
          event = "neo_tree_buffer_enter",
          handler = function()
            vim.cmd("set relativenumber")
          end,
        }
      }
      -- default_component_configs = {
      -- 	indent = {
      -- 		indent_marker = "│",
      -- 		last_indent_marker = "└",
      -- 	},
      -- },
    })
  end,
}
