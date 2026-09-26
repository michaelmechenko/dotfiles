{ config, inputs, lib, pkgs, ... }:
let
  # Keep these editable sources outside the store; packages stay Nix-owned.
  liveConfig = name: config.lib.file.mkOutOfStoreSymlink "${config.home.homeDirectory}/.dotfiles/${name}";
  palette = import ./palette.nix { inherit lib; };
  inherit (palette) roles;
  prompt = builtins.fromJSON (builtins.readFile ../../ohmyposh/base.json);
  system = pkgs.stdenv.hostPlatform.system;
  toolPkgs = import inputs.nixpkgs-tools {
    inherit system;
    config.allowUnfree = true;
  };
  tmux = toolPkgs.tmux;
  sidebar = pkgs.callPackage ../packages/mm-sidebar.nix { };
  zshCustom = pkgs.runCommand "zsh-custom-plugins" { } ''
    mkdir -p "$out/plugins/zsh-autosuggestions" "$out/plugins/zsh-syntax-highlighting"
    ln -s ${pkgs.zsh-autosuggestions}/share/zsh-autosuggestions/zsh-autosuggestions.zsh \
      "$out/plugins/zsh-autosuggestions/zsh-autosuggestions.plugin.zsh"
    ln -s ${pkgs.zsh-syntax-highlighting}/share/zsh-syntax-highlighting/zsh-syntax-highlighting.zsh \
      "$out/plugins/zsh-syntax-highlighting/zsh-syntax-highlighting.plugin.zsh"
  '';
  vp = pkgs.vimPlugins;
  nvimPluginSources = [
    { name = "Comment.nvim"; path = vp.comment-nvim; }
    { name = "LuaSnip"; path = vp.luasnip; }
    { name = "blink.cmp"; path = vp.blink-cmp; }
    { name = "dropbar.nvim"; path = vp.dropbar-nvim; }
    { name = "everforest"; path = vp.everforest; }
    { name = "flash.nvim"; path = vp.flash-nvim; }
    { name = "friendly-snippets"; path = vp.friendly-snippets; }
    { name = "gitsigns.nvim"; path = vp.gitsigns-nvim; }
    { name = "hover.nvim"; path = vp.hover-nvim; }
    { name = "jellybeans.nvim"; path = vp.jellybeans-nvim; }
    { name = "kanagawa-paper.nvim"; path = vp.kanagawa-paper-nvim; }
    { name = "koda.nvim"; path = vp.koda-nvim; }
    { name = "lazygit.nvim"; path = vp.lazygit-nvim; }
    { name = "lualine.nvim"; path = vp.lualine-nvim; }
    { name = "mason-lspconfig.nvim"; path = vp.mason-lspconfig-nvim; }
    { name = "mason.nvim"; path = vp.mason-nvim; }
    { name = "melange-nvim"; path = vp.melange-nvim; }
    { name = "mellow.nvim"; path = vp.mellow-nvim; }
    { name = "mini.files"; path = vp.mini-files; }
    { name = "mini.icons"; path = vp.mini-icons; }
    { name = "monokai-pro.nvim"; path = vp.monokai-pro-nvim; }
    { name = "neo-tree.nvim"; path = vp.neo-tree-nvim; }
    { name = "neomodern.nvim"; path = vp.neomodern-nvim; }
    { name = "nightfox.nvim"; path = vp.nightfox-nvim; }
    { name = "noice.nvim"; path = vp.noice-nvim; }
    { name = "none-ls.nvim"; path = vp.none-ls-nvim; }
    { name = "nui.nvim"; path = vp.nui-nvim; }
    { name = "nvim-autopairs"; path = vp.nvim-autopairs; }
    { name = "nvim-highlight-colors"; path = vp.nvim-highlight-colors; }
    { name = "nvim-lspconfig"; path = vp.nvim-lspconfig; }
    { name = "nvim-surround"; path = vp.nvim-surround; }
    { name = "nvim-treesitter"; path = vp.nvim-treesitter.withAllGrammars; }
    { name = "nvim-treesitter-textobjects"; path = vp.nvim-treesitter-textobjects; }
    { name = "nvim-ufo"; path = vp.nvim-ufo; }
    { name = "nvim-web-devicons"; path = vp.nvim-web-devicons; }
    { name = "plenary.nvim"; path = vp.plenary-nvim; }
    { name = "promise-async"; path = vp.promise-async; }
    { name = "rose-pine"; path = vp.rose-pine; }
    { name = "snacks.nvim"; path = vp.snacks-nvim; }
    { name = "stay-centered.nvim"; path = vp.stay-centered-nvim; }
    { name = "substrata.nvim"; path = vp.substrata-nvim; }
    { name = "trouble.nvim"; path = vp.trouble-nvim; }
    { name = "vague.nvim"; path = vp.vague-nvim; }
    { name = "which-key.nvim"; path = vp.which-key-nvim; }
  ];
  # lazy.nvim enumerates only real directories under its root, not symlinks.
  nvimPlugins = pkgs.runCommand "nvim-declarative-plugins" { } ''
    mkdir -p "$out"
    ${lib.concatMapStringsSep "\n" (plugin: ''cp -rL ${plugin.path} "$out/${plugin.name}"'') nvimPluginSources}
  '';
in
{
  home = {
    packages = with pkgs; [
      tmux sidebar neovim vimPlugins.nvim-treesitter.withAllGrammars
      git fzf ripgrep fd bat eza jq lazygit nnn moor
      zsh oh-my-zsh zsh-autosuggestions zsh-syntax-highlighting
      wl-clipboard xdg-utils bc coreutils gnused gawk findutils procps lsof
      python3 lua go gnumake gcc cargo nodejs
      nixd nixfmt lua-language-server terraform-ls marksman clang-tools
      dockerfile-language-server-nodejs vscode-langservers-extracted
      typescript-language-server pyright lemminx yaml-language-server
      bash-language-server prettier shfmt
    ];
    sessionVariables = {
      ZSH = "${pkgs.oh-my-zsh}/share/oh-my-zsh";
      ZSH_CUSTOM = "${zshCustom}";
      MM_SIDEBAR_BIN = "${sidebar}/bin/mm-sidebar";
      NVIM_LAZY_PATH = "${pkgs.vimPlugins.lazy-nvim}";
      NVIM_PLUGIN_PATH = "${nvimPlugins}";
      NVIM_TREESITTER_RTP = "${pkgs.vimPlugins.nvim-treesitter.withAllGrammars}";
      NIXOS_DECLARATIVE_NVIM = "1";
    };
    file.".tmux.conf".text = ''source-file ~/.config/tmux.conf'';
  };

  xdg.configFile = {
    "zshrc".source = liveConfig "zshrc";
    "oh-my-zsh".source = "${pkgs.oh-my-zsh}/share/oh-my-zsh";
    "zsh-custom".source = zshCustom;
    "tmux.conf".source = liveConfig "tmux.conf";
    "tmux_scripts" = { source = ../../tmux_scripts; recursive = true; };
    "tmux_plugins" = { source = ../../tmux_plugins; recursive = true; };
    "nnn/plugins" = { source = ../../nnn/plugins; recursive = true; };
    "qol_scripts/copy".source = ../../qol_scripts/copy;
    "qol_scripts/pasta".source = ../../qol_scripts/pasta;
    "nvim".source = liveConfig "nvim";
    "theme/active/tmux/colors.conf".source = ../../theme/bundles/vague/tmux/colors.conf;
    "theme/active/shell/palette.sh".source = ../../theme/bundles/vague/shell/palette.sh;
    "theme/active/nvim/native.lua".source = ../../theme/bundles/vague/nvim/native.lua;
    "theme/active/nvim/palette.lua".source = ../../theme/bundles/vague/nvim/palette.lua;
  };

  programs.ghostty = {
    enable = true;
    enableZshIntegration = true;
    settings = palette.ghostty // {
      palette = lib.imap0 (index: color: "${toString index}=${color}") palette.ansi;
      font-family = "Lilex Nerd Font";
      font-size = 13;
      cursor-style = "underline";
      cursor-style-blink = false;
      shell-integration-features = "no-cursor,sudo,ssh-env,ssh-terminfo";
      window-padding-x = 12;
      window-padding-y = 10;
      window-decoration = false;
      resize-overlay = "never";
      keybind = [
        "ctrl+shift+r=reload_config"
        "alt+backspace=text:\\x1b\\x7f"
        "alt+left=csi:1;3D"
        "alt+right=csi:1;3C"
        "alt+o=csi:111;3u"
        "alt+enter=csi:13;3u"
        "shift+enter=csi:13;2u"
        "ctrl+enter=csi:13;5u"
        "alt+tab=csi:9;3u"
        "alt+shift+tab=csi:9;4u"
        "ctrl+tab=csi:25~"
        "ctrl+shift+tab=csi:26~"
      ];
    };
  };

  programs.zsh = {
    enable = true;
    enableCompletion = false;
    autosuggestion.enable = false;
    syntaxHighlighting.enable = false;
    initContent = ''source "$HOME/.config/zshrc"'';
  };

  programs.fzf.enable = false;
  programs.eza.enable = false;
  programs.bat.enable = false;
  programs.lazygit.enable = false;
  programs.tmux.enable = false;
  programs.neovim.enable = false;

  programs.oh-my-posh = {
    enable = true;
    enableZshIntegration = false;
    settings = prompt // { palette = roles; };
  };
}
