return {
  {
    "mfussenegger/nvim-jdtls",
    event = "VeryLazy",
    config = function()
      local config = {
        cmd = { "/Users/mishka/Documents/jdtls/jdt-language-server-latest/bin/jdtls" },
        root_dir = vim.fs.dirname(vim.fs.find({ "gradlew", ".git", "mvnw" }, { upward = true })[1]),
      }
      require("jdtls").start_or_attach(config)
    end,
  },
}
