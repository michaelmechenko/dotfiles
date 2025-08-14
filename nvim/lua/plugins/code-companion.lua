return {
  {
    "olimorris/codecompanion.nvim",
    dependencies = {
      "nvim-lua/plenary.nvim",
      "nvim-treesitter/nvim-treesitter",
    },
    config = function()
      require("codecompanion").setup({
        display = {
          diff = {
            enabled = false,
          },
          chat = {
            intro_message = "llm",
            window = {
              layout = "float",
              width = 0.65,
              height = 0.8,
              -- position = "right",
            },
          },
        },
        strategies = {
          chat = {
            keymaps = {
              next_chat = {
                modes = {
                  n = ".",
                },
                index = 11,
                callback = "keymaps.next_chat",
                description = "Next Chat",
              },
              previous_chat = {
                modes = {
                  n = ",",
                },
                index = 12,
                callback = "keymaps.previous_chat",
                description = "Previous Chat",
              },
            },
            adapter = "anthropic",
            roles = {
              user = "enormous verbiage framework",
            },
            slash_commands = {
              ["file"] = {
                callback = "strategies.chat.slash_commands.file",
                description = "select using Telescope",
                opts = {
                  -- provider = "telescope",
                  provider = "snacks",
                  contains_code = true,
                },
              },
            },
          },
          inline = {
            adapter = "anthropic",
            keymaps = {
              accept_change = {
                modes = { n = "ga" },
                description = "accept change",
              },
              reject_change = {
                modes = { n = "gr" },
                description = "reject change",
              },
            },
          },
        },
        adapters = {
          openai = function()
            return require("codecompanion.adapters").extend("openai", {
              env = {
                api_key = "OPENAI_API_KEY"
              },
              schema = {
                model = {
                  default = "gpt-4o",
                  -- default = "gpt-4o-mini",
                  choices = {
                    ["o3-mini-2025-01-31"] = { opts = { can_reason = true } },
                    -- ["o3-mini"] = { opts = { can_reason = true } },
                    ["o3-mini"] = { opts = { can_reason = false } },
                    ["o1-mini"] = { opts = { stream = false } },
                    "gpt-4o",
                    "gpt-4o-mini",
                    "gpt-4-turbo-preview",
                    "gpt-4",
                    "gpt-3.5-turbo",
                  },
                },
                temperature = {
                  -- default = 0.5,
                },
              },
            })
          end,
          anthropic = function()
            return require("codecompanion.adapters").extend("anthropic", {
              env = {
                api_key = "ANTHROPIC_API_KEY"
              },
            })
          end,
          ollama = function()
            return require("codecompanion.adapters").extend("ollama", {
              env = {
                url = "http://0.0.0.0:11434",
                api_key = "OLLAMA_API_KEY",
              },
              headers = {
                ["Content-Type"] = "application/json",
                ["Authorization"] = "Bearer ${api_key}",
              },
              parameters = {
                sync = true,
              },
            })
          end,
        },
      })
    end,
  },
}
