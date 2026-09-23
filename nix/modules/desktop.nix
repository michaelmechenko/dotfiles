{ pkgs, ... }:
{
  programs.hyprland = {
    enable = true;
    withUWSM = true;
    xwayland.enable = true;
  };

  hardware.graphics.enable = true;
  hardware.graphics.enable32Bit = true;

  programs.steam = {
    enable = true;
    gamescopeSession.enable = true;
  };
  programs.gamescope.enable = true;
  programs.gamemode.enable = true;

  hardware.bluetooth.enable = true;
  services.blueman.enable = true;
  # Advanced settings for supported gaming mice (including Logitech G Pro
  # variants) are exposed through Piper; pointer acceleration stays in Hyprland.
  services.ratbagd.enable = true;
  services.udisks2.enable = true;
  security.polkit.enable = true;
  security.pam.services.hyprlock = { };

  # Hyprland's backend owns capture/sharing; GTK supplies missing interfaces.
  # Scope preferences to Hyprland so Plasma keeps its KDE portal integration.
  xdg.portal = {
    extraPortals = [ pkgs.xdg-desktop-portal-gtk ];
    config.hyprland = {
      default = [
        "hyprland"
        "gtk"
      ];
      "org.freedesktop.impl.portal.FileChooser" = [ "gtk" ];
    };
  };

  fonts.packages = with pkgs; [
    nerd-fonts.lilex
    noto-fonts
    noto-fonts-color-emoji
  ];
}
