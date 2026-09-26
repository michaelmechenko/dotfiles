{ lib, runCommand, requireFile, python3, kdePackages, roles }:
let
  archive = requireFile {
    name = "pixel-icon-library-by-hackernoon.zip";
    sha256 = "42cf4f81d6a6ccd661a238c1a63e511670eaf7e88e42051280221604e832020d";
    message = ''
      Download the free Pixel Icon Library archive from https://pixeliconlibrary.com/.
      Import the matching archive with:
        nix-store --add-fixed sha256 ~/Downloads/pixel-icon-library-by-hackernoon.zip
      See nix/README.md for attribution and the pinned checksum.
    '';
  };
  python = python3.withPackages (p: [ p.pillow ]);
  palette = builtins.toFile "pixel-icon-roles.json" (builtins.toJSON roles);
in
runCommand "hackernoon-pixel-icons" {
  nativeBuildInputs = [ python ];
  propagatedBuildInputs = [ kdePackages.breeze-icons ];
  meta = {
    description = "Locally adapted Pixel Icon Library by HackerNoon";
    license = lib.licenses.cc-by-40;
    platforms = lib.platforms.linux;
  };
} ''
  python ${./pixel-icons-build.py} ${archive} ${./pixel-icons-mapping.json} ${palette} "$out"
  python ${./pixel-icons-check.py} "$out" ${./pixel-icons-mapping.json}
''
