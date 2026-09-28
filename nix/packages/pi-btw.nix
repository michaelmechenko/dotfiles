{ fetchFromGitHub, stdenvNoCC }:
stdenvNoCC.mkDerivation {
  pname = "pi-btw";
  version = "0.6.1-unstable-2026-09-28";
  src = fetchFromGitHub {
    owner = "michaelmechenko";
    repo = "pi-btw";
    rev = "3241ec5f541367e17bff3d5ccf0c9cbca71a04ea";
    hash = "sha256-w/2PrLXmnBdna9lgpuKsnbhgXRhIUeBzQe2qRV+G8d0=";
  };
  dontBuild = true;
  installPhase = ''
    runHook preInstall
    mkdir -p "$out"
    cp -r package.json extensions skills docs README.md LICENSE "$out/"
    runHook postInstall
  '';
}
