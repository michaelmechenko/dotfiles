{ lib }:
let
  palette = builtins.fromJSON (builtins.readFile ../../theme/palettes/vague.json);
  raw = palette.roles // (palette.overrides.roles or { });
  roles = lib.fix (
    resolved:
    lib.mapAttrs (
      _: value: if lib.hasPrefix "@" value then resolved.${lib.removePrefix "@" value} else value
    ) raw
  );
  resolve = value: if lib.hasPrefix "@" value then roles.${lib.removePrefix "@" value} else value;
in
{
  inherit roles;
  ansi = palette.ansi;
  ghostty = lib.mapAttrs (_: resolve) palette.ghostty;
  hex = value: lib.removePrefix "#" value;
}
