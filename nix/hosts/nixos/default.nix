{ pkgs, ... }:
{
  # Preserve the installer configuration, including stateVersion, storage,
  # networking, SSH, and the SDDM/Plasma recovery session.
  imports = [
    ./configuration.nix
    ../../modules/desktop.nix
  ];

  nix.settings.experimental-features = [
    "nix-command"
    "flakes"
  ];
  boot.loader.systemd-boot.configurationLimit = 10;
  programs.zsh.enable = true;
  users.users.mishka.shell = pkgs.zsh;

  environment.systemPackages = with pkgs; [
    git
    curl
    pciutils
    usbutils
    vulkan-tools
  ];
}
