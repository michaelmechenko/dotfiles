{ lib, pkgs, ... }:
let
  wallpaper = ../assets/wallpapers/monet1.jpg;
  inherit (import ./palette.nix { inherit lib; }) roles hex;
in
{
  # Generate only the config. A generic graphical-session service would also
  # start in Plasma; desktop.nix launches exactly one Hyprland/UWSM instance.
  home.packages = [ pkgs.hyprpaper ];
  services.hyprpaper = {
    enable = true;
    package = null;
    settings = {
      splash = false;
      wallpaper = [
        {
          monitor = "*";
          path = toString wallpaper;
          fit_mode = "cover";
        }
      ];
    };
  };

  programs.hyprlock.settings.background = [
    {
      monitor = "";
      path = toString wallpaper;
      color = "rgb(${hex roles.canvas})";
      blur_passes = 3;
      blur_size = 8;
      brightness = 0.75;
    }
  ];
}
