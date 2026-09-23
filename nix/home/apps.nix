{ inputs, pkgs, ... }:
let
  system = pkgs.stdenv.hostPlatform.system;
  grimoire = pkgs.callPackage ../packages/grimoire.nix { };
  helium = pkgs.callPackage ../packages/helium.nix { };
  sidra = inputs.sidra.packages.${system}.sidra;
in
{
  home.packages = with pkgs; [
    grimoire
    helium
    sidra
    legcord
    kdePackages.dolphin
    kdePackages.ark
    # Plasma KCMs launched from Hyprland need QML modules that Plasma normally
    # injects into its own session environment.
    kdePackages.kdeclarative
    kdePackages.kitemmodels
    # KDE's display KCM talks to KWin; use the compositor-neutral Wayland UI
    # for live monitor layout changes under Hyprland.
    wdisplays
    piper
  ];

  xdg.mimeApps = {
    enable = true;
    defaultApplications = {
      "text/html" = [ "helium.desktop" ];
      "x-scheme-handler/http" = [ "helium.desktop" ];
      "x-scheme-handler/https" = [ "helium.desktop" ];
      "x-scheme-handler/about" = [ "helium.desktop" ];
      "x-scheme-handler/unknown" = [ "helium.desktop" ];
      "inode/directory" = [ "org.kde.dolphin.desktop" ];
    };
  };
}
