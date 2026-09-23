{
  lib,
  appimageTools,
  fetchurl,
}:
let
  pname = "grimoire-mod-manager";
  version = "1.28.1";
  src = fetchurl {
    url = "https://github.com/Slush97/grimoire/releases/download/v${version}/Grimoire-${version}.AppImage";
    hash = "sha256-q+QnLo1aaZ3bWSbEjGC+yITh4IthgyUeAJ0tcurbWhk=";
  };
  contents = appimageTools.extractType2 {
    inherit pname version src;
  };
in
appimageTools.wrapType2 {
  inherit pname version src;

  extraInstallCommands = ''
    install -Dm444 ${contents}/grimoire.desktop \
      $out/share/applications/grimoire.desktop
    substituteInPlace $out/share/applications/grimoire.desktop \
      --replace-fail 'Exec=AppRun' 'Exec=grimoire-mod-manager'

    install -Dm444 ${contents}/usr/share/icons/hicolor/512x512/apps/grimoire.png \
      $out/share/icons/hicolor/512x512/apps/grimoire.png
  '';

  meta = {
    description = "Mod manager and companion tool for Deadlock";
    homepage = "https://grimoiremods.com";
    license = lib.licenses.mit;
    sourceProvenance = [ lib.sourceTypes.binaryNativeCode ];
    platforms = [ "x86_64-linux" ];
    mainProgram = "grimoire-mod-manager";
  };
}
