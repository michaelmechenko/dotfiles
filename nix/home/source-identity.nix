{ config, lib, pkgs, ... }:
let
  # This runs against the immutable build input, not a post-build checkout hash.
  manifest = pkgs.runCommand "nixos-live-source.json" { } ''
    ${pkgs.python3}/bin/python3 ${../public-source.py} live-manifest ${../..} > "$out"
  '';
in
{
  xdg.configFile."nixos/live-source.json".source = manifest;
  # Old generations cannot safely activate against newer live sources. Stop
  # before Home Manager's mutation boundary, without touching private state.
  home.activation.verifyLiveSources = lib.hm.dag.entryBefore [ "writeBoundary" ] ''
    ${pkgs.python3}/bin/python3 ${../public-source.py} verify-live \
      ${lib.escapeShellArg "${config.home.homeDirectory}/.dotfiles"} ${manifest}
  '';
}
