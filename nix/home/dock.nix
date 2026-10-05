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
    /* Layer-shell namespaces are not CSS IDs. Only #box is the dock panel;
       the other top-level windows are invisible reveal detectors. */
    window {
      background: transparent;
      color: ${roles.text};
      border: none;
      border-radius: 0;
      box-shadow: none;
    }
    #box {
      background: ${roles.surface-chrome};
      border: 2px solid ${roles.divider-subtle};
      border-radius: 8px;
      padding: 6px;
    }
    * { font-family: "Lilex Nerd Font", sans-serif; font-size: 13px; }
    button, image { background: none; border: none; box-shadow: none; }
    #box button {
      padding: 4px;
      margin: 0 3px;
      color: ${roles.text-ui};
      border-radius: 4px;
      /* An inset outline keeps focus visible without changing allocation. */
      outline: 1px solid transparent;
      outline-offset: -1px;
      transition: none;
    }
    #box button:hover, #box button:active, #box button:checked {
      background: ${roles.surface-highlight};
      color: ${roles.text};
    }
    #box button:focus {
      outline-color: ${roles.accent-secondary};
      color: ${roles.accent-secondary};
    }
    /* Upstream sets this name only outside autohide mode. */
    #active { border-bottom: 1px solid ${roles.accent-secondary}; }
    menu, tooltip {
      background: ${roles.surface-chrome};
      color: ${roles.text};
      border: 2px solid ${roles.divider-subtle};
      border-radius: 8px;
      padding: 4px;
      box-shadow: none;
    }
    menu menuitem {
      background: none;
      color: ${roles.text-ui};
      border: none;
      border-radius: 4px;
      padding: 4px 8px;
      transition: none;
    }
    menu menuitem:hover, menu menuitem:active, menu menuitem:selected {
      background: ${roles.surface-highlight};
      color: ${roles.accent-secondary};
    }
    menu menuitem:disabled { color: ${roles.text-muted}; }
    menu separator {
      background: ${roles.divider-subtle};
      min-height: 1px;
      margin: 4px 8px;
      padding: 0;
      border: none;
    }
    tooltip label { color: ${roles.text}; padding: 2px 4px; }
  '';
}
