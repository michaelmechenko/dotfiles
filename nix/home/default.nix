{ config, pkgs, ... }:
{
  imports = [
    ./terminal.nix
    ./desktop.nix
    ./icons.nix
    ./apps.nix
    ./pi.nix
    ./source-identity.nix
  ];

  home = {
    username = "mishka";
    homeDirectory = "/home/mishka";
    stateVersion = "26.05";
    sessionVariables = {
      EDITOR = "nvim";
      VISUAL = "nvim";
    };
    packages = with pkgs; [
      curl
      wget
      jq
      ripgrep
      fd
      unzip
      zip
      tree
      htop
      wl-clipboard
      xdg-utils
      libnotify
      pavucontrol
      networkmanagerapplet
      playerctl
      grim
      slurp
    ];
  };

  programs.git.enable = true;

  programs.gh = {
    enable = true;
    settings.git_protocol = "https";
    gitCredentialHelper.enable = true;
  };

  xdg.enable = true;
  # Match the existing locations, including Projects; do not move/create data.
  xdg.userDirs = {
    enable = true;
    createDirectories = false;
    desktop = "${config.home.homeDirectory}/Desktop";
    documents = "${config.home.homeDirectory}/Documents";
    download = "${config.home.homeDirectory}/Downloads";
    music = "${config.home.homeDirectory}/Music";
    pictures = "${config.home.homeDirectory}/Pictures";
    projects = "${config.home.homeDirectory}/Projects";
    publicShare = "${config.home.homeDirectory}/Public";
    templates = "${config.home.homeDirectory}/Templates";
    videos = "${config.home.homeDirectory}/Videos";
  };
}
