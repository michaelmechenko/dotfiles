{ config, lib, pkgs, ... }:
let
  inherit (import ./palette.nix { inherit lib; }) roles;
  pixelIcons = pkgs.callPackage ../packages/pixel-icons.nix { inherit roles; };
in
{
  # Shared theme declaration. Deliberately do not enable GTK's whole-file
  # management: Plasma already owns populated, writable GTK settings files.
  gtk.iconTheme = {
    name = "HackerNoonPixel";
    package = pixelIcons;
  };
  home.packages = [ pixelIcons pkgs.kdePackages.breeze-icons ];

  # The pinned Home Manager KConfig writer changes only these INI keys,
  # preserving existing GTK fonts, cursor, dark preference and KDE colors.
  qt.kde.settings = {
    kdeglobals.Icons.Theme = config.gtk.iconTheme.name;
    "gtk-3.0/settings.ini".Settings.gtk-icon-theme-name = config.gtk.iconTheme.name;
    "gtk-4.0/settings.ini".Settings.gtk-icon-theme-name = config.gtk.iconTheme.name;
  };
  dconf.settings."org/gnome/desktop/interface".icon-theme = config.gtk.iconTheme.name;
}
