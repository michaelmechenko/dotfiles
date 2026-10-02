{ lib, pkgs, ... }:
let
  inherit (import ./palette.nix { inherit lib; }) roles;
  dock = pkgs.callPackage ../packages/nwg-dock-hyprland.nix { };
  seed = pkgs.writeShellApplication {
    name = "nwg-dock-seed";
    runtimeInputs = [ pkgs.coreutils ];
    text = builtins.readFile ./dock-seed.sh;
  };
  aliases = pkgs.runCommand "nwg-dock-desktop-aliases" {
    nativeBuildInputs = [ pkgs.desktop-file-utils ];
  } ''
    mkdir -p "$out"
    cp ${pkgs.obsidian}/share/applications/obsidian.desktop "$out/md.obsidian.Obsidian.desktop"
    cp ${pkgs.kdePackages.dolphin}/share/applications/org.kde.dolphin.desktop "$out/dolphin.desktop"
    chmod u+w "$out/"*.desktop
    for entry in "$out/"*.desktop; do
      desktop-file-edit --set-key=NoDisplay --set-value=true "$entry"
    done
  '';
in
{
  home.packages = [ dock ];
  # Only the dock rewrites pins. Activation seeds missing state, including in
  # an XDG cache override; Home Manager's run wrapper respects dry-run mode.
  home.activation.seedDockPins = lib.hm.dag.entryAfter [ "writeBoundary" ] ''
    run ${seed}/bin/nwg-dock-seed
  '';
  xdg.dataFile = {
    "applications/md.obsidian.Obsidian.desktop".source = "${aliases}/md.obsidian.Obsidian.desktop";
    "applications/dolphin.desktop".source = "${aliases}/dolphin.desktop";
  };
  xdg.configFile."nwg-dock-hyprland/style.css".text = ''
    window {
      background: ${roles.surface-chrome};
      color: ${roles.text};
      border: 1px solid ${roles.divider-subtle};
      border-radius: 8px;
    }
    #box { padding: 6px; }
    button, image { background: none; border: none; box-shadow: none; }
    button { padding: 4px; margin: 0 3px; color: ${roles.text-ui}; }
    button:hover { background: ${roles.surface-highlight}; border-radius: 4px; }
    button:focus { box-shadow: none; }
    #active { border-bottom: 1px solid ${roles.accent-secondary}; }
  '';
}
