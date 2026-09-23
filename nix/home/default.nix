{ pkgs, ... }:
{
  imports = [
    ./terminal.nix
    ./desktop.nix
    ./apps.nix
    ./pi.nix
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
  xdg.enable = true;
}
