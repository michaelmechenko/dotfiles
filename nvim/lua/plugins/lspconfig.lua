return {
  {
    "williamboman/mason.nvim",
    opts = {
      ui = {
        icons = {
          package_installed = "✓",
          package_pending = "➜",
          package_uninstalled = "✗",
        },
      },
    },
  },
  {
    "williamboman/mason-lspconfig.nvim",
    config = function()
      require("mason-lspconfig").setup({
        ensure_installed = {
          "lua_ls",
          -- "rust_analyzer",
          "clangd",
          -- "cmake",
          "cssls",
          "dockerls",
          -- "gopls",
          "html",
          "biome",
          "pyright",
          "svelte",
          "tailwindcss",
          "lemminx",
          -- "jdtls",
        },
        automatic_enable = false
      })
    end,
  },
  {
    "neovim/nvim-lspconfig",
    config = function()
      local lspconfig = require("lspconfig")
      lspconfig.lua_ls.setup({})
      -- lspconfig.rust_analyzer.setup({})
      lspconfig.clangd.setup({})
      -- lspconfig.cmake.setup({})
      lspconfig.dockerls.setup({})
      -- lspconfig.gopls.setup({})
      lspconfig.html.setup({})
      lspconfig.biome.setup({})
      lspconfig.pyright.setup({})
      lspconfig.svelte.setup({})
      lspconfig.tailwindcss.setup({})
      lspconfig.lemminx.setup({})
      -- lspconfig.jdtls.setup({
      --   init_options = {
      --     bundles = bundles,
      --   },
      --   handlers = {
      --     -- By assigning an empty function, you can remove the notifications
      --     -- printed to the cmd
      --     ["$/progress"] = function(_, result, ctx) end,
      --   },
      -- })
      -- lspconfig.ccls.setup({
      -- 	init_options = {
      -- 		compilationDatabaseDirectory = "build",
      -- 		index = {
      -- 			threads = 0,
      -- 		},
      -- 		clang = {
      -- 			excludeArgs = { "-frounding-math" },
      -- 		},
      -- 	},
      -- })
    end,
  },
  -- {
  -- 	"nvim-java/nvim-java",
  -- 	config = function()
  -- 		require("java").setup({ --  list of file that exists in root of the project
  -- 			root_markers = {
  -- 				"settings.gradle",
  -- 				"settings.gradle.kts",
  -- 				"pom.xml",
  -- 				"build.gradle",
  -- 				"mvnw",
  -- 				"gradlew",
  -- 				"build.gradle",
  -- 				"build.gradle.kts",
  -- 				".git",
  -- 			},
  --
  -- 			jdtls = {
  -- 				version = "latest",
  -- 			},
  --
  -- 			lombok = {
  -- 				version = "nightly",
  -- 			},
  --
  -- 			-- load java test plugins
  -- 			java_test = {
  -- 				enable = true,
  -- 				-- enable = false,
  -- 				version = "0.43.0",
  -- 			},
  --
  -- 			-- load java debugger plugins
  -- 			java_debug_adapter = {
  -- 				enable = true,
  -- 				-- enable = false,
  -- 				version = "0.58.1",
  -- 			},
  --
  -- 			spring_boot_tools = {
  -- 				-- enable = true,
  -- 				enable = false,
  -- 				version = "1.59.0",
  -- 			},
  --
  -- 			-- jdk = {
  -- 			-- 	-- install jdk using mason.nvim
  -- 			-- 	auto_install = true,
  -- 			-- 	version = "17.0.2",
  -- 			-- },
  --
  -- 			notifications = {
  -- 				-- enable 'Configuring DAP' & 'DAP configured' messages on start up
  -- 				dap = true,
  -- 			},
  --
  -- 			-- We do multiple verifications to make sure things are in place to run this
  -- 			-- plugin
  -- 			verification = {
  -- 				-- nvim-java checks for the order of execution of following
  -- 				-- * require('java').setup()
  -- 				-- * require('lspconfig').jdtls.setup()
  -- 				-- IF they are not executed in the correct order, you will see a error
  -- 				-- notification.
  -- 				-- Set following to false to disable the notification if you know what you
  -- 				-- are doing
  -- 				invalid_order = true,
  --
  -- 				-- nvim-java checks if the require('java').setup() is called multiple
  -- 				-- times.
  -- 				-- IF there are multiple setup calls are executed, an error will be shown
  -- 				-- Set following property value to false to disable the notification if
  -- 				-- you know what you are doing
  -- 				duplicate_setup_calls = true,
  --
  -- 				-- nvim-java checks if nvim-java/mason-registry is added correctly to
  -- 				-- mason.nvim plugin.
  -- 				-- IF it's not registered correctly, an error will be thrown and nvim-java
  -- 				-- will stop setup
  -- 				invalid_mason_registry = false,
  -- 			},
  -- 		})
  -- 	end,
  -- },
}
