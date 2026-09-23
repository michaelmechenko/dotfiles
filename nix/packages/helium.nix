{
  lib,
  stdenv,
  fetchurl,
  dpkg,
  patchelf,
  makeWrapper,
  wrapGAppsHook3,
  makeFontsConf,
  symlinkJoin,
  qt6,
  glib,
  gsettings-desktop-schemas,
  gtk3,
  gtk4,
  adwaita-icon-theme,
  nss,
  nspr,
  libGL,
  libgbm,
  libdrm,
  libxkbcommon,
  libX11,
  libXcomposite,
  libXdamage,
  libXext,
  libXfixes,
  libXrandr,
  libXrender,
  libxcb,
  libxshmfence,
  libXi,
  libXcursor,
  libXft,
  libXScrnSaver,
  libXtst,
  libSM,
  libICE,
  alsa-lib,
  alsa-plugins,
  dbus,
  cups,
  ffmpeg,
  libva,
  pipewire,
  wayland,
  vulkan-loader,
  systemd,
  xdg-utils,
  coreutils,
  pango,
  cairo,
  gdk-pixbuf,
  atk,
  at-spi2-atk,
  at-spi2-core,
  freetype,
  fontconfig,
  libuuid,
  expat,
  zlib,
  libxml2,
  libkrb5,
  snappy,
  udev,
  libXt,
  noto-fonts-cjk-sans,
  noto-fonts-cjk-serif,
}:
let
  version = "0.17.2.1";
  deps = [
    stdenv.cc.cc nss nspr libGL libgbm libdrm libxkbcommon libX11
    libXcomposite libXdamage libXext libXfixes libXrandr libXrender libxcb
    libxshmfence libXi libXcursor libXft libXScrnSaver libXtst libSM libICE
    alsa-lib dbus cups ffmpeg libva pipewire wayland vulkan-loader systemd
    pango cairo gdk-pixbuf atk at-spi2-atk at-spi2-core freetype fontconfig
    libuuid expat zlib libxml2 gtk3 glib libXt libkrb5 snappy udev
  ];
  libPath = lib.makeLibraryPath deps
    + lib.optionalString stdenv.hostPlatform.is64bit
      (":" + lib.makeSearchPathOutput "lib" "lib64" deps)
    + ":$out/opt/helium";
  fontsConf = makeFontsConf {
    fontDirectories = [ noto-fonts-cjk-sans noto-fonts-cjk-serif ];
  };
  alsaPluginDirectory = symlinkJoin {
    name = "helium-alsa-plugins";
    paths = [ "${pipewire}/lib/alsa-lib" "${alsa-plugins}/lib/alsa-lib" ];
  };
in
stdenv.mkDerivation {
  pname = "helium";
  inherit version;

  src = fetchurl {
    url = "https://github.com/imputnet/helium-linux/releases/download/${version}/helium-bin_${version}-1_amd64.deb";
    hash = "sha256-xb4AhHoTY/AE+B07jnDKJmsVrgKgKdLLHhG2TThTaSk=";
  };

  dontConfigure = true;
  dontBuild = true;
  dontPatchELF = true;
  dontStrip = true;

  nativeBuildInputs = [
    dpkg patchelf makeWrapper wrapGAppsHook3 qt6.wrapQtAppsHook
  ];
  dontWrapQtApps = true;
  buildInputs = [
    glib gsettings-desktop-schemas gtk3 gtk4 adwaita-icon-theme
    qt6.qtbase qt6.qtwayland libXt libkrb5 snappy udev systemd
  ];

  unpackPhase = ''
    runHook preUnpack
    dpkg-deb -x "$src" .
    runHook postUnpack
  '';

  installPhase = ''
    runHook preInstall
    mkdir -p "$out/bin" "$out/opt"
    cp -r opt/helium "$out/opt/helium"
    cp -r usr/share "$out/share"

    for executable in helium helium_crashpad_handler; do
      patchelf \
        --set-interpreter "$(cat "$NIX_CC/nix-support/dynamic-linker")" \
        --set-rpath "${libPath}" \
        "$out/opt/helium/$executable"
    done
    for library in "$out/opt/helium/libEGL.so" "$out/opt/helium/libGLESv2.so"; do
      test ! -f "$library" || patchelf --set-rpath "${libPath}" "$library"
    done

    substituteInPlace "$out/opt/helium/helium-wrapper" \
      --replace-fail '$HERE/helium' "$out/opt/helium/helium"
    ln -s "$out/opt/helium/helium-wrapper" "$out/bin/helium"

    substituteInPlace "$out/share/applications/helium.desktop" \
      --replace-fail 'Exec=helium' "Exec=$out/bin/helium" \
      --replace-fail 'Icon=helium' "Icon=$out/share/icons/hicolor/256x256/apps/helium.png"
    mkdir -p "$out/share/icons/hicolor/256x256/apps"
    cp "$out/opt/helium/product_logo_256.png" \
      "$out/share/icons/hicolor/256x256/apps/helium.png"
    runHook postInstall
  '';

  preFixup = ''
    gappsWrapperArgs+=(
      --prefix LD_LIBRARY_PATH : "${libPath}"
      --set ALSA_PLUGIN_DIR "${alsaPluginDirectory}"
      --prefix PATH : ${lib.makeBinPath [ xdg-utils coreutils ]}
      --add-flags "\''${NIXOS_OZONE_WL:+\''${WAYLAND_DISPLAY:+--ozone-platform-hint=auto}}"
      --set-default CHROME_VERSION_EXTRA nix
      --set FONTCONFIG_FILE "${fontsConf}"
    )
  '';

  meta = {
    description = "Private Chromium-based web browser";
    homepage = "https://helium.computer";
    license = lib.licenses.gpl3Only;
    sourceProvenance = [ lib.sourceTypes.binaryNativeCode ];
    platforms = [ "x86_64-linux" ];
    mainProgram = "helium";
  };
}
